import { test } from "bun:test"
import assert from "node:assert/strict"
import { createNativeSolver } from "../../../src/adapters"
import { convertIbisComponentWithPackage } from "../../../src/buffers/package-conversion"
import { subcircuitHeader } from "../../../src/buffers/spice-netlist"
import { source } from "../../fixtures/coupled-package"
import { packageInput, renderPackageModel } from "../../fixtures/package-input"

test("ngspice solves mixed scalar and merged matrix packages", async () => {
  const input = packageInput(await renderPackageModel())
  const pinMap = input.definition.pinMap
  // IBIS 6.1 section 7: unlisted pins use [Pin] then [Package], while
  // an unlisted member of a modeled [Pin Mapping] rail bus is merged.
  const prefix = source.slice(0, source.indexOf("[Define Package Model]"))
  const partial = `${prefix}[Define Package Model] coupled
[Manufacturer] Test
[OEM] Test
[Description] Only the signal pins have matrix matrices
[Number Of Pins] 2
[Pin Numbers]
B1
A1
[Model Data]
[Resistance Matrix] Full_matrix
[Row] B1
2 .2
[Row] A1
1
[Inductance Matrix] Full_matrix
[Row] B1
4n -1n
[Row] A1
2n
[Capacitance Matrix] Full_matrix
[Row] B1
3p -.5p
[Row] A1
2p
[End Model Data]
[End Package Model]
[End]`
  const partialSource = partial.replace(
    "G1 VSS GND 6 6n 6p",
    "G1 VSS GND NA NA NA",
  )
  const unlisted = convertIbisComponentWithPackage({
    bytes: new TextEncoder().encode(partialSource),
    input: input,
  })
  const busSource = source
    .replace(
      "[Model] input",
      `[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref power_clamp_ref
A1 GND VDD GND VDD
B1 GND VDD GND VDD
G1 GND NC NC NC
G2 GND NC NC NC
V1 NC VDD NC NC
V2 NC VDD NC NC
[Model] input`,
    )
    .replace(
      "[Pin] signal_name model_name R_pin L_pin C_pin",
      "[Pin] signal_name model_name R_pin L_pin C_pin\nG2 VSS GND\nV2 VDD POWER",
    )
  const busStart = busSource.indexOf("[Define Package Model]")
  const mergedDefinition = busSource
    .slice(busStart)
    .replaceAll("G1", "G2")
    .replaceAll("V1", "V2")
  const mergedSource = `${busSource.slice(0, busStart)}${mergedDefinition}`
  const references = Object.fromEntries(
    ["A1", "B1"].map((pin) => [
      pin,
      {
        pullup: pinMap.V1,
        powerClamp: pinMap.V1,
        pulldown: pinMap.G1,
        groundClamp: pinMap.G1,
      },
    ]),
  )
  const merged = convertIbisComponentWithPackage({
    bytes: new TextEncoder().encode(mergedSource),
    input: {
      ...input,
      definition: { ...input.definition, references },
    },
  })
  const solve = createNativeSolver({
    tools: { ngspice: process.env.NGSPICE_BIN || "ngspice" },
  })
  for (const mixed of [unlisted, merged]) {
    const name = subcircuitHeader(mixed.source)?.[1]
    assert.ok(name)
    const deck = [
      "Mixed package only AC oracle",
      mixed.source,
      `XTEST a b v g ${name}`,
      "VA a 0 ac 1",
      "VB b 0 ac 0",
      "VV v 0 1.5",
      "VG g 0 0",
      ".control",
      "ac lin 1 1Meg 1Meg",
      "quit",
      ".endc",
      ".end",
    ].join("\n")
    const result = await solve({
      solver: "ngspice",
      files: { "mixed.cir": deck },
      args: ["-n", "-b", "mixed.cir"],
      outputFiles: [],
    })
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /error|fatal|aborted|singular/i,
      "mixed scalar/matrix and merged rail netlists are valid in ngspice",
    )
    assert.match(result.stdout, /No\. of Data Rows\s*:\s*1/)
  }
})

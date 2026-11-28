import { test } from "bun:test"
import assert from "node:assert/strict"
import { convertIbisModelToSpice } from "@tscircuit/ibis-to-spice"
import { createNativeSolver } from "../../../src/adapters"
import { source } from "../../fixtures/coupled-package"
import { packageInput, renderPackageModel } from "../../fixtures/package-input"

test("uses one lossless package branch for rail pins merged on the board", async () => {
  const base = packageInput(await renderPackageModel(true))
  const { pinMap } = base.definition
  const input = {
    ...base,
    definition: {
      ...base.definition,
      references: {
        A1: { pullup: pinMap.V1, powerClamp: pinMap.V1 },
        B1: { pullup: pinMap.V2, powerClamp: pinMap.V2 },
      },
    },
  }
  const ibis = source
    .replace(
      "[Model] input",
      `V2 VDD2 POWER
[Pin Mapping] pulldown_ref pullup_ref gnd_clamp_ref power_clamp_ref
A1 GND PWR GND PWR
B1 GND PWR GND PWR
G1 GND NC GND NC
V1 NC NC NC PWR
V2 NC NC NC PWR
[Model] input`,
    )
    .replace(
      source.slice(
        source.indexOf("[Resistance Matrix]"),
        source.indexOf("[Inductance Matrix]"),
      ),
      "",
    )
  const solve = createNativeSolver({
    tools: { ngspice: process.env.NGSPICE_BIN || "ngspice" },
  })
  for (const mergedPinsKeyword of ["", "[Merged Pins] V1\nV2\n"]) {
    const converted = convertIbisModelToSpice(
      ibis.replace("[Model Data]", `${mergedPinsKeyword}[Model Data]`),
      input.definition,
      input.run,
    )
    assert.deepEqual(converted.metadata.packageData.matrices?.mergedPins, {
      V2: "V1",
    })
    assert.doesNotMatch(converted.source, /^V(?:DIE|PKGM)/m)
    assert.match(converted.source, /^XBUF0 PKGD0 PKGD2 PKGD3 PKGD2 PKGD3 /m)
    assert.match(converted.source, /^XBUF1 PKGD1 PKGD2 PKGD3 PKGD2 PKGD3 /m)
    const name = converted.source.split("\n")[1].split(" ")[1]
    assert.ok(name)
    const nodes = Object.values(converted.spicePinMapping).map((port) => {
      if (port === pinMap.A1) return "in_a"
      if (port === pinMap.B1) return "in_b"
      if (port === pinMap.G1) return "0"
      return "vdd"
    })
    const deck = [
      "Merged lossless package with a board supply",
      converted.source,
      `XU ${nodes.join(" ")} ${name}`,
      "VDD vdd 0 1.5",
      "VA in_a 0 0",
      "VB in_b 0 0",
      ".control",
      "op",
      "print v(vdd)",
      "quit",
      ".endc",
      ".end",
    ].join("\n")
    const result = await solve({
      solver: "ngspice",
      files: { "rails.cir": deck },
      args: ["-n", "-b", "rails.cir"],
      outputFiles: [],
    })
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /singular|error|fatal|aborted/i,
    )
    assert.match(result.stdout, /v\(vdd\) = 1\.500000e\+00/)
  }
})

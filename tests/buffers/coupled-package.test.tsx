import { setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import { Circuit } from "@tscircuit/core"
import { parseIbis } from "@tscircuit/ibis-to-spice"
import React from "react"
import { addrCmdPins } from "../../examples/routed/ddr3-signals"
import { createNativeSolver } from "../../src/adapters"
import {
  coupledPackage,
  coupledPackageElements,
} from "../../src/buffers/coupled-package"
import { convertPackaged } from "../../src/buffers/package"
import { splitWords, subcircuitHeader } from "../../src/buffers/text"
import { Board, source } from "../fixtures/coupled-package"
import { vendorAvailable, vendorText } from "../fixtures/vendor-models"
import {
  energyFacts,
  isGroundedMaxwell,
  isPositiveDefinite,
  maxwellFacts,
} from "../support/golden-checks"

setDefaultTimeout(150_000)

test("TSX coupled package replaces scalar values, preserves ideal die rails and realizes signed R/L/C", async () => {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  const model = circuit
    .getCircuitJson()
    .find((record) => record.type === "simulation_ibis_model")!
  if (model.type !== "simulation_ibis_model")
    throw new Error("Missing TSX IBIS model")
  const pinMap = model.ibis_pin_name_to_source_port_id
  const input = {
    definition: {
      source: { content: source },
      component: "fixture",
      pinMap,
      corner: "typical" as const,
      packagePolicy: "vendor" as const,
    },
    run: {
      duration: "1ns",
      pinStates: {
        [pinMap.A1]: { mode: "input" as const },
        [pinMap.B1]: { mode: "input" as const },
      },
      stimuli: {},
    },
  }
  const converted = convertPackaged({
    bytes: new TextEncoder().encode(source),
    input,
  })
  assert.match(converted.source, /KPKG\d+_\d+ LPKG\d+ LPKG\d+ -0\.353553/)
  assert.match(converted.source, /HPKG/)
  assert.match(converted.source, /CPKG0_1a PAD0 PAD1 2\.5e-13/)
  assert.match(converted.source, /VPDN\d+ DIE\d+ 0 1\.5/)
  assert.match(converted.source, /VPDN\d+ DIE\d+ 0 0/)
  assert.doesNotMatch(converted.source, / 99(?:\s|$)| 9e-9(?:\s|$)/)
  assert.deepEqual(converted.metadata.omissions, [])
  assert.deepEqual(converted.metadata.packageData.matrices?.pins, [
    "A1",
    "B1",
    "V1",
    "G1",
  ])
  assert.equal(
    converted.metadata.packageData.mappedPins.find(
      (pin) => pin.physicalPin === "A1",
    )?.resistanceOhms,
    1,
  )
  const resistanceWarning = converted.warnings.find((warning) =>
    warning.startsWith("A1:"),
  )
  assert.match(resistanceWarning ?? "", /A1.*resistance.*9.*1/)
  const missingPackage = source.replace(
    "[Define Package Model] coupled",
    "[Define Package Model] absent",
  )
  const variantInput = {
    ...input,
    definition: { ...input.definition, source: { file: "fixture.ibs" } },
  }
  assert.throws(
    () =>
      convertPackaged({
        bytes: new TextEncoder().encode(missingPackage),
        input: variantInput,
      }),
    /missing.*scalar fallback is forbidden/i,
  )
  // IBIS 6.1 section 7: unlisted pins use [Pin] then [Package], while
  // an unlisted member of a modeled [Pin Mapping] rail bus is merged.
  const prefix = source.slice(0, source.indexOf("[Define Package Model]"))
  const partial = `${prefix}[Define Package Model] coupled
[Manufacturer] Test
[OEM] Test
[Description] Only the signal pins have matrix data
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
  const unlisted = convertPackaged({
    bytes: new TextEncoder().encode(partialSource),
    input: variantInput,
  })
  assert.deepEqual(unlisted.metadata.packageData.matrices?.pins, ["A1", "B1"])
  assert.match(unlisted.source, /RPKGU2 REF0 \S+ 7\n/)
  assert.match(unlisted.source, /LPKGU2 \S+ \S+ 7(?:\.0+1)?e-9\n/)
  assert.match(unlisted.source, /RPKGU3 REF1 \S+ 99\n/)
  assert.match(unlisted.source, /LPKGU3 \S+ \S+ 9\.9e-8\n/)
  assert.match(unlisted.source, /CPKGU2a REF0 DIE3 3\.5e-12/)
  assert.match(unlisted.source, /CPKGU3a REF1 DIE3 4\.95e-11/)
  assert.match(unlisted.source, /VPDN2 DIE2 0 1\.5/)
  assert.match(unlisted.source, /VPDN3 DIE3 0 0/)
  const packageElements = unlisted.source
    .split("\n")
    .filter((line) =>
      ["R", "V", "L", "C", "H", "K"].some((kind) =>
        line.startsWith(`${kind}PKG`),
      ),
    )
  const identifiers = packageElements.map((line) => line.split(" ")[0])
  assert.equal(
    new Set(identifiers).size,
    identifiers.length,
    "scalar and matrix element names cannot collide",
  )
  assert.equal(
    unlisted.metadata.packageData.mappedPins.find(
      (pin) => pin.physicalPin === "V1",
    )?.resistanceOhms,
    7,
  )
  assert.equal(
    unlisted.metadata.packageData.mappedPins.find(
      (pin) => pin.physicalPin === "G1",
    )?.resistanceOhms,
    99,
  )
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
  const merged = convertPackaged({
    bytes: new TextEncoder().encode(mergedSource),
    input: {
      ...variantInput,
      definition: { ...variantInput.definition, references },
    },
  })
  assert.deepEqual(merged.metadata.packageData.matrices?.pins, [
    "A1",
    "B1",
    "V2",
    "G2",
  ])
  assert.deepEqual(merged.metadata.packageData.matrices?.mergedPins, {
    V1: "V2",
    G1: "G2",
  })
  assert.match(merged.source, /VPKGM2 REF0 PKGM2 0/)
  assert.match(merged.source, /VPKGM3 REF1 PKGM3 0/)
  assert.doesNotMatch(merged.source, /RPKGU|LPKGU|CPKGU/)
  const noSelectedRows = partial.replace(
    "[Model] input",
    "C1 C input\nD1 D input\n[Model] input",
  )
  const noSelectedStart = noSelectedRows.indexOf("[Define Package Model]")
  const scalarDefinition = noSelectedRows
    .slice(noSelectedStart)
    .replaceAll("A1", "C1")
    .replaceAll("B1", "D1")
  const scalarSource = `${noSelectedRows.slice(0, noSelectedStart)}${scalarDefinition}`
  const scalar = convertPackaged({
    bytes: new TextEncoder().encode(scalarSource),
    input: variantInput,
  })
  assert.deepEqual(scalar.metadata.packageData.matrices?.pins, [])
  assert.match(scalar.source, /RPKGU0 PAD0 \S+ 9\n/)
  assert.doesNotMatch(scalar.source, /KPKG/)
  if (process.env.SI_TEST_PACKAGE_NGSPICE !== "1") return
  const data = {
    pins: ["A", "B"],
    R: [
      [1, -0.2],
      [-0.2, 2],
    ],
    L: [
      [2e-9, 1e-9],
      [1e-9, 4e-9],
    ],
    C: [
      [2e-12, -0.5e-12],
      [-0.5e-12, 3e-12],
    ],
  }
  const elements = coupledPackageElements({
    matrices: data,
    terminals: ["a", "b"],
    die: ["0", "0"],
    ground: "0",
  })
  const deck = [
    "Package only AC oracle",
    ...elements,
    "VA a 0 ac 1",
    "VB b 0 ac 0",
    ".control",
    "set wr_singlescale",
    "set wr_vecnames",
    "ac lin 1 1Meg 1Meg",
    "wrdata package.dat v(a) v(b) i(VPKGS0) i(VPKGS1) i(VA) i(VB)",
    "quit",
    ".endc",
    ".end",
  ].join("\n")
  const ngspice = process.env.NGSPICE_BIN ?? "/opt/homebrew/bin/ngspice"
  const solve = createNativeSolver({ timeoutMs: 10000, tools: { ngspice } })
  const result = await solve({
    solver: "ngspice",
    files: { "package.cir": deck },
    args: ["-n", "-b", "package.cir"],
    outputFiles: ["package.dat"],
  })
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /error|fatal|aborted/i,
  )
  const values = splitWords(
    result.files["package.dat"].trim().split("\n")[1].trim(),
  ).map(Number)
  const omega = 2 * Math.PI * 1e6
  for (let i = 0; i < 2; i++) {
    const real = [0, 1].reduce((sum, j) => {
      const resistance = data.R[i][j] * values[5 + 2 * j]
      const reactance = omega * data.L[i][j] * values[6 + 2 * j]
      return sum + resistance - reactance
    }, 0)
    const imaginary = [0, 1].reduce((sum, j) => {
      const resistance = data.R[i][j] * values[6 + 2 * j]
      const reactance = omega * data.L[i][j] * values[5 + 2 * j]
      return sum + resistance + reactance
    }, 0)
    assert.ok(
      Math.abs(real - values[1 + 2 * i]) < 1e-7,
      "real series impedance matches the full R matrix",
    )
    assert.ok(
      Math.abs(imaginary - values[2 + 2 * i]) < 1e-7,
      "imaginary series impedance matches signed mutual L",
    )
    const capacitanceError =
      -values[10 + 2 * i] - values[6 + 2 * i] - (omega * data.C[i][0]) / 2
    assert.ok(
      Math.abs(capacitanceError) < 1e-8,
      "board-side pi capacitance matches Maxwell C",
    )
  }
  for (const mixed of [unlisted, merged]) {
    const name = subcircuitHeader(mixed.source)![1]
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

const coupledSelection = `golden invariants: DDR3 coupled-package selections stay SPD with |k| < 1, Maxwell ${"C and realizable K"}`
test.skipIf(!vendorAvailable("sprm552c.ibs"))(coupledSelection, async () => {
  // Same physics as the full-matrix check (tests/buffers/package-matrix.test.ts), on the exact pin sets the DDR3
  // TSX declarations select (examples/routed/ddr3-signals.tsx). Schur reduction of floating unused pins preserves
  // definiteness (Horn & Johnson, Matrix Analysis, 2nd ed., Theorem 7.7.6), and ngspice K must satisfy |k| < 1.
  const text = await vendorText("sprm552c.ibs")
  const component = parseIbis(text).components.am335x_zcz
  const sets = {
    addrCmd: addrCmdPins.map(([, pin]) => pin),
    dqWrite: ["M3", "M4", "N1", "N2", "N3", "N4", "P3", "P4", "M2", "P1", "P2"],
  }
  const failures: string[] = []
  for (const [name, signals] of Object.entries(sets)) {
    const selected = coupledPackage({
      text,
      component,
      pins: [...signals, "E5", "A1"],
    })!
    const L = energyFacts(selected.L)
    const C = energyFacts(selected.C)
    const maxwell = maxwellFacts(selected.C)
    const elements = coupledPackageElements({
      matrices: selected,
      terminals: selected.pins.map((_, i) => `B${i}`),
      die: selected.pins.map((_, i) => `D${i}`),
      ground: "G",
    })
    const couplings = elements.filter((line) => line.startsWith("K"))
    const k = Math.max(
      ...couplings.map((line) => Math.abs(Number(line.split(" ")[3]))),
    )
    console.log(
      JSON.stringify({
        set: name,
        pins: selected.pins.length,
        mergedPins: selected.mergedPins,
        L,
        C,
        maxwell,
        largestKElement: k,
        largestKPins: L.pair.map((i) => selected.pins[i]),
      }),
    )
    if (!isPositiveDefinite(L)) failures.push(`${name} L: ${JSON.stringify(L)}`)
    if (!isPositiveDefinite(C)) failures.push(`${name} C: ${JSON.stringify(C)}`)
    if (!isGroundedMaxwell({ facts: maxwell }))
      failures.push(`${name} Maxwell: ${JSON.stringify(maxwell)}`)
    if (!(k < 1)) failures.push(`${name}: K element ${k}`)
  }
  assert.deepEqual(failures, [])
})

const scalarPackage =
  "golden invariants: Winbond DDR3 has no coupled package and every [Pin] R, L, C is non-negative"
test.skipIf(!vendorAvailable("W631GG6MB-12.ibs"))(scalarPackage, async () => {
  // A scalar lumped package is passive iff each R, L and C is non-negative (1 x 1 energy matrices).
  const text = await vendorText("W631GG6MB-12.ibs")
  const component = parseIbis(text).components["W631GG6MB-12"]
  assert.equal(
    coupledPackage({ text, component, pins: Object.keys(component.pins) }),
    undefined,
  )
  const pinValues = Object.values(component.pins).flatMap((pin) => [
    pin.resistance,
    pin.inductance,
    pin.capacitance,
  ])
  const values = pinValues.filter((value) => value !== undefined)
  console.log(
    JSON.stringify({
      pins: Object.keys(component.pins).length,
      scalarValues: values.length,
      package: component.package,
    }),
  )
  assert.ok(
    values.length > 0 &&
      values.every((value) => Number.isFinite(value) && value! >= 0),
  )
})

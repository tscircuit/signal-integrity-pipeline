import { test } from "bun:test"
import assert from "node:assert/strict"
import { createNativeSolver } from "../../../src/adapters"
import { buildCoupledPackageSpiceElements } from "../../../src/buffers/coupled-package"
import { splitWords } from "../../../src/buffers/source-tokens"

test("ngspice matches R, signed mutual L and Maxwell capacitance", async () => {
  const fixtureMatrices = {
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
  const elements = buildCoupledPackageSpiceElements({
    matrices: fixtureMatrices,
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
  const ngspice = process.env.NGSPICE_BIN || "ngspice"
  const solve = createNativeSolver({ tools: { ngspice } })
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
  const acSamples = splitWords(
    result.files["package.dat"].trim().split("\n")[1].trim(),
  ).map(Number)
  const omega = 2 * Math.PI * 1e6
  for (let i = 0; i < 2; i++) {
    const real = [0, 1].reduce((sum, j) => {
      const resistance = fixtureMatrices.R[i][j] * acSamples[5 + 2 * j]
      const reactance = omega * fixtureMatrices.L[i][j] * acSamples[6 + 2 * j]
      return sum + resistance - reactance
    }, 0)
    const imaginary = [0, 1].reduce((sum, j) => {
      const resistance = fixtureMatrices.R[i][j] * acSamples[6 + 2 * j]
      const reactance = omega * fixtureMatrices.L[i][j] * acSamples[5 + 2 * j]
      return sum + resistance + reactance
    }, 0)
    assert.ok(
      Math.abs(real - acSamples[1 + 2 * i]) < 1e-7,
      "real series impedance matches the full R matrix",
    )
    assert.ok(
      Math.abs(imaginary - acSamples[2 + 2 * i]) < 1e-7,
      "imaginary series impedance matches signed mutual L",
    )
    const capacitanceError =
      -acSamples[10 + 2 * i] -
      acSamples[6 + 2 * i] -
      (omega * fixtureMatrices.C[i][0]) / 2
    assert.ok(
      Math.abs(capacitanceError) < 1e-8,
      "board-side pi capacitance matches Maxwell C",
    )
  }
})

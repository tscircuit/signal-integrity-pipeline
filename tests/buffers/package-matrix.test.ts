import { test } from "bun:test"
import assert from "node:assert/strict"
import { selectPackageModel } from "../../src/buffers/package-matrix"
import type { PackageModel } from "../../src/buffers/package-model"
import { vendorAvailable, vendorText } from "../fixtures/vendor-models"

const model: PackageModel = {
  name: "fixture",
  manufacturer: "test",
  oem: "test",
  description: "test",
  pins: ["B", "unused", "A"],
  R: [
    [1, 0.1, -0.2],
    [0.1, 2, 0],
    [-0.2, 0, 3],
  ],
  L: [
    [4e-9, 1e-9, -5e-10],
    [1e-9, 3e-9, 0],
    [-5e-10, 0, 2e-9],
  ],
  C: [
    [3e-12, -1e-12, -5e-13],
    [-1e-12, 2e-12, -5e-13],
    [-5e-13, -5e-13, 4e-12],
  ],
}

test("reduces floating pins in the selected order", () => {
  const selected = selectPackageModel({ model, pins: ["A", "B"] })
  assert.deepEqual(selected.pins, ["A", "B"])
  assert.deepEqual(selected.R, [
    [3, -0.2],
    [-0.2, 1],
  ])
  assert.deepEqual(selected.L, [
    [2e-9, -5e-10],
    [-5e-10, 4e-9],
  ])
  assert.ok(Math.abs(selected.C[0][0] - 3.875e-12) < 1e-26)
  assert.ok(Math.abs(selected.C[1][1] - 2.5e-12) < 1e-26)
  assert.ok(Math.abs(selected.C[0][1] + 0.75e-12) < 1e-26)
  assert.deepEqual(selected.unusedPins, ["unused"])
  assert.equal(
    selected.selfTerms.C[0],
    4e-12,
    "metadata retains original self C before floating reduction",
  )
})

test("rejects an absent package pin", () => {
  assert.throws(
    () => selectPackageModel({ model, pins: ["A", "VSS"] }),
    /VSS.*missing.*scalar fallback is forbidden/,
  )
})

test("checks passivity before reduction", () => {
  for (const field of ["L", "C"] as const) {
    assert.throws(
      () =>
        selectPackageModel({
          model: {
            ...model,
            [field]: [
              [1, 2, 0],
              [2, 1, 0],
              [0, 0, 1],
            ],
          },
          pins: model.pins,
        }),
      /positive definite|Maxwell/,
    )
    assert.throws(
      () =>
        selectPackageModel({
          model: {
            ...model,
            [field]: [
              [1, -1, 0],
              [-1, 1, 0],
              [0, 0, 1],
            ],
          },
          pins: model.pins,
        }),
      /positive definite/,
    )
    assert.throws(
      () =>
        selectPackageModel({
          model: {
            ...model,
            [field]: [
              [1, 0, 0],
              [0, 1, 2],
              [0, 2, 1],
            ],
          },
          pins: ["B"],
        }),
      /positive definite|Maxwell/,
      "invalid unused blocks cannot disappear during reduction",
    )
  }
})

test("rejects mixed capacitance signs", () => {
  assert.throws(
    () =>
      selectPackageModel({
        model: {
          ...model,
          C: [
            [1, 0.1, -0.1],
            [0.1, 1, 0],
            [-0.1, 0, 1],
          ],
        },
        pins: model.pins,
      }),
    /Maxwell.*positive off-diagonal/,
  )
})

test("rejects negative reference capacitance", () => {
  assert.throws(
    () =>
      selectPackageModel({
        model: {
          ...model,
          C: [
            [1, -2, 0],
            [-2, 5, 0],
            [0, 0, 1],
          ],
        },
        pins: model.pins,
      }),
    /reference capacitance/,
  )
})

test("rejects nonpassive resistance", () => {
  assert.throws(
    () =>
      selectPackageModel({
        model: {
          ...model,
          R: [
            [1, 2, 0],
            [2, 1, 0],
            [0, 0, 1],
          ],
        },
        pins: model.pins,
      }),
    /resistance.*positive semidefinite/,
  )
})

test("accepts semidefinite resistance", () => {
  assert.doesNotThrow(() =>
    selectPackageModel({
      model: {
        ...model,
        R: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
      pins: model.pins,
    }),
  )
  assert.doesNotThrow(
    () =>
      selectPackageModel({
        model: {
          ...model,
          R: [
            [1, 1, 1],
            [1, 1, 1],
            [1, 1, 1],
          ],
        },
        pins: model.pins,
      }),
    "rank-deficient passive resistance is supported",
  )
})

import { parsePackageModel } from "../../src/buffers/package-model"
import { energyFacts, maxwellFacts } from "../support/golden-checks"

/** Allow floating-point roundoff in matrix symmetry and the resistance eigenvalue. */
const ENERGY_MATRIX_TOLERANCE = 1e-12
/** Scale henries to nanohenries for the diagnostic. */
const NANOHENRIES_PER_HENRY = 1e9

/** Accept tiny negative Maxwell row sums from floating-point reduction. */
const MAXWELL_ROW_SUM_TOLERANCE = 1e-9

const am335xPackage = `golden invariants: AM335x vendor package L, C are SPD with |k| < 1 and C is ${"Maxwell after sign correction"}`
test.skipIf(!vendorAvailable("sprm552c.ibs"))(am335xPackage, async () => {
  // A passive reciprocal lumped package (IBIS 7.x [Define Package Model]; Paul, Inductance: Loop and Partial, ch. 5):
  // L and C symmetric positive definite, every |k| = |M_ij|/sqrt(L_ii L_jj) < 1; R PSD; the Maxwell C has positive
  // diagonal, non-positive off-diagonal entries and non-negative row sums. Tolerances are floating point only.
  const text = await vendorText("sprm552c.ibs")
  const model = parsePackageModel({ text, name: "am335x_zcz" })
  const selected = selectPackageModel({ model, pins: model.pins })
  const L = energyFacts(model.L)
  const C = energyFacts(selected.C)
  const R = energyFacts(model.R)
  const maxwell = maxwellFacts(selected.C)
  const self = model.L.map((row, i) => row[i])
  const mutual = model.L.map((row, i) =>
    row.reduce((sum, value, j) => {
      if (i === j) return sum + 0
      return sum + Math.abs(value)
    }, 0),
  )
  const positiveRaw = model.C.flat().filter(
    (value, index) => index % (model.pins.length + 1) !== 0 && value > 0,
  ).length
  console.log(
    JSON.stringify({
      pins: model.pins.length,
      L,
      C,
      R,
      maxwell,
      rawPositiveOffDiagonalC: positiveRaw,
      signCorrection: selected.capacitanceSignCorrection,
      selfLnH: [
        Math.min(...self) * NANOHENRIES_PER_HENRY,
        Math.max(...self) * NANOHENRIES_PER_HENRY,
      ],
      summedMutualLnH: [
        Math.min(...mutual) * NANOHENRIES_PER_HENRY,
        Math.max(...mutual) * NANOHENRIES_PER_HENRY,
      ],
      largestKPins: L.pair.map((i) => model.pins[i]),
    }),
  )
  for (const [name, facts] of [
    ["L", L],
    ["C", C],
  ] as const) {
    const passive =
      facts.asymmetry <= ENERGY_MATRIX_TOLERANCE &&
      facts.minimumEigenvalue > 0 &&
      facts.coupling < 1
    assert.ok(passive, `${name}: ${JSON.stringify(facts)}`)
  }
  assert.ok(
    R.minimumEigenvalue >= -ENERGY_MATRIX_TOLERANCE * R.maximumEigenvalue,
    `R: ${JSON.stringify(R)}`,
  )
  const validMaxwell =
    maxwell.minimumDiagonal > 0 &&
    maxwell.maximumOffDiagonal <= 0 &&
    maxwell.minimumRowSum >= -MAXWELL_ROW_SUM_TOLERANCE
  assert.ok(validMaxwell, `Maxwell: ${JSON.stringify(maxwell)}`)
})

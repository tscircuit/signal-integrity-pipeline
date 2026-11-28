import { test } from "bun:test"
import assert from "node:assert/strict"
import { parseIbis, reducePackageMatrices } from "@tscircuit/ibis-to-spice"
import {
  loadVendorModelText,
  vendorAvailable,
  vendorModels,
} from "../../fixtures/vendor-models"
import { energyFacts, maxwellFacts } from "../../support/golden-checks"

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
  const text = await loadVendorModelText(vendorModels.am335x)
  const model = parseIbis(text).getPackageModel("am335x_zcz")
  const selected = reducePackageMatrices({ model, pins: model.pins })
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

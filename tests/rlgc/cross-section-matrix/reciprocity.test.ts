import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  assertMatrixPassive,
  calculateReciprocityResidual,
} from "../../../src/rlgc/cross-section-matrix"

test("distinguishes zero, nonfinite and nonreciprocal coefficients", () => {
  assert.equal(calculateReciprocityResidual([[0]]), 0)
  assert.ok(Number.isNaN(calculateReciprocityResidual([[NaN]])))
  assert.throws(() => assertMatrixPassive({ matrix: [[NaN]] }), {
    code: "matrix_format",
  })
  assert.throws(
    () =>
      assertMatrixPassive({
        matrix: [
          [1, 0.5],
          [0, 1],
        ],
      }),
    { code: "reciprocity" },
  )
})

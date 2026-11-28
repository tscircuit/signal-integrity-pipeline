import { test } from "bun:test"
import assert from "node:assert/strict"
import { factorBoundaryMatrix } from "../../../src/rlgc/cross-section-matrix"

test("singular pivots fail", () => {
  assert.throws(() => factorBoundaryMatrix([Float64Array.of(0)]), {
    code: "matrix_zero",
  })
})

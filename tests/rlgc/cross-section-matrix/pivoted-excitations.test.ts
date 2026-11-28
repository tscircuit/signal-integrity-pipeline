import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  factorBoundaryMatrix,
  solveBoundarySystem,
} from "../../../src/rlgc/cross-section-matrix"

test("pivoted factors solve independent excitations", () => {
  const matrix = [
    [0, 1, 2],
    [1, 3, 1],
    [2, 1, 4],
  ]
  const boundaryMatrix = matrix.map((row) => Float64Array.from(row))
  const factors = factorBoundaryMatrix(boundaryMatrix)
  assert.deepEqual(
    boundaryMatrix.map((row) => Array.from(row)),
    matrix,
  )
  for (const rightHandSides of [
    [
      [1, 0],
      [0, 1],
      [0, 0],
    ],
    [[1], [-2], [3]],
  ]) {
    const x = solveBoundarySystem({ factors, rightHandSides })
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < rightHandSides[0].length; j++) {
        const product = matrix[i].reduce(
          (sum, coefficient, k) => sum + coefficient * x[k][j],
          0,
        )
        assert.ok(Math.abs(product - rightHandSides[i][j]) < 1e-12)
      }
    }
  }
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  sectionFactor,
  sectionInverse,
  sectionPassive,
} from "../../src/extraction/cross-section-matrix"

test("pivoted factors solve independent excitations", () => {
  const matrix = [
    [0, 1, 2],
    [1, 3, 1],
    [2, 1, 4],
  ]
  const solve = sectionFactor(matrix.map((row) => Float64Array.from(row)))
  for (const rhs of [
    [
      [1, 0],
      [0, 1],
      [0, 0],
    ],
    [[1], [-2], [3]],
  ]) {
    const x = solve(rhs)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < rhs[0].length; j++) {
        const product = matrix[i].reduce(
          (sum, value, k) => sum + value * x[k][j],
          0,
        )
        assert.ok(Math.abs(product - rhs[i][j]) < 1e-12)
      }
    }
  }
})

test("inverse uses pivoted factors", () => {
  const inverse = sectionInverse([
    [2, 1],
    [1, 2],
  ])
  assert.ok(Math.abs(inverse[0][0] - 2 / 3) < 1e-14)
})

test("singular pivots fail", () => {
  assert.throws(() => sectionFactor([Float64Array.of(0)]), {
    code: "matrix_zero",
  })
})

test("loss may have a null space", () => {
  sectionPassive({
    matrix: [
      [0, 0],
      [0, 1],
    ],
  })
})

test("strict passivity rejects a null space", () => {
  assert.throws(() => sectionPassive({ matrix: [[0]], strict: true }), {
    code: "passivity",
  })
})

test("nonpassive energy fails", () => {
  assert.throws(
    () =>
      sectionPassive({
        matrix: [
          [1, 2],
          [2, 1],
        ],
      }),
    { code: "passivity" },
  )
})

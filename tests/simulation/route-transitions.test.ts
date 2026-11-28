import { test } from "bun:test"
import assert from "node:assert/strict"
import type { CopperPoint } from "../../src/board"
import { terminalInductance } from "../../src/simulation"

const line = [
  [0.55e-6, 0.22e-6],
  [0.22e-6, 0.55e-6],
]
const positions: CopperPoint[] = [
  [0, 0],
  [0, 0.3],
]
const terminal = {
  height: 0.4,
  width: 0.15,
  depth: 0.075,
  positions,
  perLength: line,
}

test("estimates vertical terminal coupling", () => {
  const matrix = terminalInductance(terminal)
  assert.ok(matrix[0][0] > 0.09e-9 && matrix[0][0] < 0.11e-9)
  assert.ok(matrix[0][1] > 0.01e-9 && matrix[0][1] < 0.025e-9)
})

test("keeps terminal coupling reciprocal", () => {
  const matrix = terminalInductance(terminal)
  assert.equal(matrix[0][1], matrix[1][0])
})

test("scales inductance with terminal dimensions", () => {
  const matrix = terminalInductance(terminal)
  const scaled = terminalInductance({
    height: 0.8,
    width: 0.3,
    depth: 0.15,
    positions: [
      [0, 0],
      [0, 0.6],
    ],
    perLength: line,
  })
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      assert.ok(Math.abs(scaled[i][j] - 2 * matrix[i][j]) < 1e-24)
    }
  }
})

test("rejects zero terminal height", () => {
  assert.throws(
    () => terminalInductance({ ...terminal, height: 0 }),
    /dimensions/,
  )
})

test("rejects overlapping terminal posts", () => {
  assert.throws(
    () =>
      terminalInductance({
        ...terminal,
        positions: [
          [0, 0],
          [0, 0.1],
        ],
      }),
    /overlap/,
  )
})

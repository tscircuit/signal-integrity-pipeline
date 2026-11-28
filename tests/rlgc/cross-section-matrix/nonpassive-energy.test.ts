import { test } from "bun:test"
import assert from "node:assert/strict"
import { assertMatrixPassive } from "../../../src/rlgc/cross-section-matrix"

test("nonpassive energy fails", () => {
  assert.throws(
    () =>
      assertMatrixPassive({
        matrix: [
          [1, 2],
          [2, 1],
        ],
      }),
    { code: "passivity" },
  )
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { assertMatrixPassive } from "../../../src/rlgc/cross-section-matrix"

test("strict passivity rejects a null space", () => {
  assert.throws(() => assertMatrixPassive({ matrix: [[0]], isStrict: true }), {
    code: "passivity",
  })
})

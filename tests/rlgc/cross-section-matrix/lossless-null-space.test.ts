import { test } from "bun:test"
import { assertMatrixPassive } from "../../../src/rlgc/cross-section-matrix"

test("loss may have a null space", () => {
  assertMatrixPassive({
    matrix: [
      [0, 0],
      [0, 1],
    ],
  })
})

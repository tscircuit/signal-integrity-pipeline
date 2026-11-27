import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  COHN_DEFAULT_TOLERANCE,
  PARALLEL_PLATE_TOLERANCE,
  parallelPlate,
} from "../../fixtures/rlgc-golden"

test("golden stage 3: parallel-plate limit at w/b = 20", () => {
  const wide = parallelPlate(20)
  const relativeError = Math.abs(wide.solved / wide.exact - 1)
  assert.ok(
    relativeError <= COHN_DEFAULT_TOLERANCE,
    `tracks Cohn within 1%: ${wide.solved} vs ${wide.exact}`,
  )
  assert.ok(
    wide.solved < parallelPlate(10).solved,
    "decreases monotonically from w/b = 10",
  )
  assert.ok(
    Math.abs(wide.solved - 1) <= PARALLEL_PLATE_TOLERANCE,
    `within 3% of C_pp: ${wide.solved}`,
  )
}, 30_000)

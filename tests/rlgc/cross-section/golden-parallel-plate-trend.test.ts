import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  COHN_DEFAULT_TOLERANCE,
  parallelPlate,
} from "../../fixtures/rlgc-golden"

test("golden stage 3: parallel-plate trend C/C_pp -> 1 for w/b = 2, 5, 10", () => {
  const rows = [2, 5, 10].map((ratio) => ({
    wOverB: ratio,
    ...parallelPlate(ratio),
  }))
  console.table(rows)
  assert.ok(
    rows.every(
      (row) => Math.abs(row.solved / row.exact - 1) <= COHN_DEFAULT_TOLERANCE,
    ),
    "tracks Cohn within 1%",
  )
  assert.ok(
    rows.every((row, i) => !i || row.solved < rows[i - 1].solved),
    "decreases monotonically",
  )
}, 30_000)

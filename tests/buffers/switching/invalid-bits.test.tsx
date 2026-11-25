import { test } from "bun:test"
import assert from "node:assert/strict"

import { convert, run, switchingInput } from "../../fixtures/switching"

test("rejects invalid stimulus bits", async () => {
  const input = await switchingInput()
  assert.throws(
    () => convert({ next: run({ input, bits: "2", interval: "1.25ns" }) }),
    { code: "invalid_pattern" },
  )
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { offsetTraceEnds } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("0.1 mm traces connect when their ends are about 0.054 mm apart", async () => {
  const board = await offsetTraceEnds({ separation: 0.05 })
  assert.doesNotThrow(() => validate(board))
})

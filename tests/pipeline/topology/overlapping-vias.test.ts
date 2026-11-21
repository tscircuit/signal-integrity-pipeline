import { test } from "bun:test"
import assert from "node:assert/strict"
import { pairedVias } from "../../fixtures/topology-via-board"
import { validate } from "../../fixtures/validate-topology-board"

test("overlapping via rings join otherwise separate stubs", async () => {
  const board = await pairedVias(0.3)
  assert.doesNotThrow(() => validate(board))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { standaloneViaRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a standalone via connects traces on different layers", async () => {
  const board = await standaloneViaRoute()
  assert.doesNotThrow(() => validate(board))
})

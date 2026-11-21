import { test } from "bun:test"
import assert from "node:assert/strict"
import { standaloneViaRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a standalone via connects copper off its center on both layers", async () => {
  const board = await standaloneViaRoute({ offset: 0.1 })
  assert.doesNotThrow(() => validate(board))
})

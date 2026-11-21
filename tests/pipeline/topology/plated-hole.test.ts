import { test } from "bun:test"
import assert from "node:assert/strict"
import { platedHoleRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a plated hole connects traces on different layers", async () => {
  const board = await platedHoleRoute()
  assert.doesNotThrow(() => validate(board))
})

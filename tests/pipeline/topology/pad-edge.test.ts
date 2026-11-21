import { test } from "bun:test"
import assert from "node:assert/strict"
import { padContactRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a route can reach the receiver pad away from its center", async () => {
  const board = await padContactRoute({ offset: 0.14 })
  assert.doesNotThrow(() => validate(board))
})

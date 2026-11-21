import { test } from "bun:test"
import assert from "node:assert/strict"
import { padContactRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a pad and wire within the copper tolerance contact", async () => {
  const board = await padContactRoute({ offset: 0.250006 })
  assert.doesNotThrow(() => validate(board))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { padContactRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a gap beyond the copper tolerance leaves a pad and wire disconnected", async () => {
  const board = await padContactRoute({ offset: 0.25002 })
  assert.throws(() => validate(board), { code: "channel_net" })
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { pairedVias } from "../../fixtures/topology-via-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a gap between via rings leaves their stubs disconnected", async () => {
  const board = await pairedVias(0.48)
  assert.throws(() => validate(board), { code: "channel_net" })
})

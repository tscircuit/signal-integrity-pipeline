import { test } from "bun:test"
import assert from "node:assert/strict"
import { unroutedExtraPin } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an unrouted declared receiver is rejected", async () => {
  const board = await unroutedExtraPin({ receiver: "STUB" })
  assert.throws(() => validate(board), {
    code: "channel_net",
    message: /is not routed between TX\.SIG and STUB\.SIG/,
  })
})

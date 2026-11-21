import { test } from "bun:test"
import assert from "node:assert/strict"
import { unroutedExtraPin } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an unrouted same-net pin outside the channel does not block its routed receiver", async () => {
  const board = await unroutedExtraPin({ receiver: "RX" })
  assert.doesNotThrow(() => validate(board))
})

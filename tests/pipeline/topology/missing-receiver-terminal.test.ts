import { test } from "bun:test"
import assert from "node:assert/strict"
import { missingReceiverTerminal } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a receiver without a PCB terminal cannot inherit the driver terminal", async () => {
  const board = await missingReceiverTerminal()
  assert.throws(() => validate(board), {
    code: "channel_receiver_terminal_missing",
    message:
      /is not routed between TX\.SIG and RX\.SIG: the receiver has no PCB terminal/,
  })
})

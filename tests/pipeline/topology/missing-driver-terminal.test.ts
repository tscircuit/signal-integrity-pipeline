import { test } from "bun:test"
import assert from "node:assert/strict"
import { missingReceiverTerminal } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("strict routing diagnoses a missing driver terminal", async () => {
  const board = await missingReceiverTerminal({ missing: "driver" })
  assert.throws(() => validate(board), {
    code: "channel_driver_terminal_missing",
    message: /RX\.SIG: the driver has no PCB terminal/,
  })
})

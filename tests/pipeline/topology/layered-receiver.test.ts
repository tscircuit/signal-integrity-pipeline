import { test } from "bun:test"
import assert from "node:assert/strict"
import { layeredReceiver } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a wire reaching one of the receiver pads routes the receiver", async () => {
  const board = await layeredReceiver()
  assert.doesNotThrow(() => validate(board))
})

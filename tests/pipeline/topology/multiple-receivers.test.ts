import { test } from "bun:test"
import assert from "node:assert/strict"
import { daisyChain } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a linear copper path supports more than one receiver", async () => {
  const board = await daisyChain({ receivers: ["MID", "RX"] })
  assert.doesNotThrow(() => validate(board))
})

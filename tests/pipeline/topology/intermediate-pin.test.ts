import { test } from "bun:test"
import assert from "node:assert/strict"
import { daisyChain } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a linear copper path can pass through an undeclared intermediate pin", async () => {
  const board = await daisyChain({ receivers: ["RX"] })
  assert.doesNotThrow(() => validate(board))
})

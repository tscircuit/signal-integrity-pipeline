import { test } from "bun:test"
import assert from "node:assert/strict"
import { midSegmentPads } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("out-of-order interior pad contacts preserve a linear route", async () => {
  const board = await midSegmentPads()
  assert.doesNotThrow(() => validate(board))
})

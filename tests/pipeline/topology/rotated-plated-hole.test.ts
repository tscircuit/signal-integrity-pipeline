import { test } from "bun:test"
import assert from "node:assert/strict"
import { rotatedPlatedHole } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a wire ending off-center reaches a rotated plated-hole pad", async () => {
  const board = await rotatedPlatedHole()
  assert.doesNotThrow(() => validate(board))
})

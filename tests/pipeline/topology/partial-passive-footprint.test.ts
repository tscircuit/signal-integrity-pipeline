import { test } from "bun:test"
import assert from "node:assert/strict"
import { partialPassiveFootprint } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a passive without both PCB terminals cannot add a routed branch", async () => {
  const board = await partialPassiveFootprint()
  assert.doesNotThrow(() => validate(board))
})

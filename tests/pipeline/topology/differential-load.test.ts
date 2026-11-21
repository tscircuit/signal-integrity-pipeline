import { test } from "bun:test"
import assert from "node:assert/strict"
import { differentialTerminationRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a cross-leg termination load leaves both differential paths linear", async () => {
  const board = await differentialTerminationRoute()
  assert.doesNotThrow(() => validate(board))
})

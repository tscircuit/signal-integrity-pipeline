import { test } from "bun:test"
import assert from "node:assert/strict"
import { differentialTerminationRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a cross-leg load stays out of both paths when its positive terminal is pin two", async () => {
  const board = await differentialTerminationRoute({ positiveTerminal: "pin2" })
  assert.doesNotThrow(() => validate(board))
})

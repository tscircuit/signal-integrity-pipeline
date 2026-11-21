import { test } from "bun:test"
import assert from "node:assert/strict"
import { differentialSeriesPassive } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a passive on just one differential leg supplies a series connection", async () => {
  const board = await differentialSeriesPassive()
  assert.doesNotThrow(() => validate(board))
})

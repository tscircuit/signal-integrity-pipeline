import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeOnlyViaRing } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an embedded via ring connects off-center copper on both layers", async () => {
  const board = await routeOnlyViaRing({ gap: 0.1 })
  assert.doesNotThrow(() => validate(board))
})

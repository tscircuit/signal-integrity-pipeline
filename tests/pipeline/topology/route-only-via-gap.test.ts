import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeOnlyViaRing } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an embedded ring does not contact copper outside its diameter", async () => {
  const board = await routeOnlyViaRing({ gap: 0.3 })
  assert.throws(() => validate(board), { code: "channel_net" })
})

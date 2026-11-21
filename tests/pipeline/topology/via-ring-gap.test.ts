import { test } from "bun:test"
import assert from "node:assert/strict"
import { standaloneViaRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("traces clear of the outer via diameter stay disconnected", async () => {
  const board = await standaloneViaRoute({ offset: 0.3 })
  assert.throws(() => validate(board), { code: "channel_net" })
})

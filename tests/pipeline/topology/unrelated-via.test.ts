import { test } from "bun:test"
import assert from "node:assert/strict"
import { standaloneViaRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an overlapping barrel on an unrelated net cannot complete the path", async () => {
  const board = await standaloneViaRoute({ viaNet: "OTHER" })
  assert.throws(() => validate(board), { code: "channel_net" })
})

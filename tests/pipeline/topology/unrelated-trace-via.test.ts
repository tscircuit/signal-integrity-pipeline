import { test } from "bun:test"
import assert from "node:assert/strict"
import { standaloneViaRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a via on an unrelated source trace cannot connect the signal stubs", async () => {
  const board = await standaloneViaRoute({ viaPort: "OTHER", offset: 0.1 })
  assert.throws(() => validate(board), { code: "channel_net" })
})

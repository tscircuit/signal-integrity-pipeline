import { test } from "bun:test"
import assert from "node:assert/strict"
import { crossingRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a same-layer crossing between route vertices forms a junction", async () => {
  const board = await crossingRoute()
  assert.throws(() => validate(board), {
    code: "channel_fanout",
    message: /branched routes are not supported yet/,
  })
})

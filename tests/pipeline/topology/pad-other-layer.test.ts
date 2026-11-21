import { test } from "bun:test"
import assert from "node:assert/strict"
import { padContactRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("trace copper cannot connect to a pad on a different layer", async () => {
  const otherLayer = await padContactRoute({ offset: 0.14, layer: "bottom" })
  assert.throws(() => validate(otherLayer), {
    code: "channel_net",
    message: /is not routed between/,
  })
})

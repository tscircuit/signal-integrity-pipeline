import { test } from "bun:test"
import assert from "node:assert/strict"
import { padContactRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a gap between trace copper and the receiver pad leaves the receiver unrouted", async () => {
  const gap = await padContactRoute({ offset: 0.3 })
  assert.throws(() => validate(gap), {
    code: "channel_net",
    message: /is not routed between/,
  })
})

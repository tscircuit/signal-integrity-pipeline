import { spyOn, test } from "bun:test"
import assert from "node:assert/strict"
import { Polygon } from "@flatten-js/core"
import { parallelTraceGap } from "../../fixtures/topology-gap-board"
import { validate } from "../../fixtures/validate-topology-board"

test("parallel 0.1 mm traces spaced 0.12 mm apart do not connect", async () => {
  const board = await parallelTraceGap()
  const distance = spyOn(Polygon.prototype, "distanceTo")
  try {
    assert.throws(() => validate(board), { code: "channel_net" })
    assert.equal(distance.mock.calls.length, 0)
  } finally {
    distance.mockRestore()
  }
})

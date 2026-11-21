import { test } from "bun:test"
import assert from "node:assert/strict"
import { driverBranch } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("permissive routing still rejects branches in rendered copper", async () => {
  const board = await driverBranch()
  assert.throws(() => validate({ ...board, allowUnroutedTraces: true }), {
    code: "channel_fanout",
  })
})

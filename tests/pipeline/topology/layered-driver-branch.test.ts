import { test } from "bun:test"
import assert from "node:assert/strict"
import { layeredDriverBranch } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a branch on one driver layer is diagnosed even when its other terminal is isolated", async () => {
  const board = await layeredDriverBranch()
  assert.throws(() => validate(board), { code: "channel_fanout" })
})

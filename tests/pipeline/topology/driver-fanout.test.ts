import { test } from "bun:test"
import assert from "node:assert/strict"
import { driverBranch } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("the driver may not have two outgoing copper paths", async () => {
  const board = await driverBranch()
  assert.throws(() => validate(board), { code: "channel_fanout" })
})

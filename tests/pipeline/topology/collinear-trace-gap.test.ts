import { test } from "bun:test"
import assert from "node:assert/strict"
import { collinearTraceGap } from "../../fixtures/topology-gap-board"
import { validate } from "../../fixtures/validate-topology-board"

test("collinear 0.1 mm traces with ends 0.12 mm apart do not connect", async () => {
  const board = await collinearTraceGap()
  assert.throws(() => validate(board), { code: "channel_net" })
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { throughPadGap } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a through-pad point cannot manufacture copper across a gap", async () => {
  const board = await throughPadGap()
  assert.ok(
    board.circuit.some(
      (record) =>
        record.type === "pcb_trace" &&
        record.route.some((point) => point.route_type === "through_pad"),
    ),
  )
  assert.throws(() => validate(board), { code: "channel_net" })
})

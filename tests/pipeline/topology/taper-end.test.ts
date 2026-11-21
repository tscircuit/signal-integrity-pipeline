import { test } from "bun:test"
import assert from "node:assert/strict"
import { taperedRoute } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("the end width of a taper can contact a receiver pad", async () => {
  const board = await taperedRoute({ wideEnd: "end" })
  assert.ok(
    board.circuit.some(
      (record) =>
        record.type === "pcb_trace" &&
        record.route.some(
          (point) =>
            point.route_type === "wire" &&
            point.start_width === 0.1 &&
            point.end_width === 0.6,
        ),
    ),
  )
  assert.doesNotThrow(() => validate(board))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { taperedRoute } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a saved wire with only a start width uses it throughout the segment", async () => {
  const board = await taperedRoute({ wideEnd: "start", omitEndWidth: true })
  const wire = board.circuit
    .filter((record) => record.type === "pcb_trace")
    .flatMap(({ route }) => route)
    .find((point) => point.route_type === "wire" && point.start_width === 0.6)
  assert.ok(wire?.route_type === "wire")
  assert.equal(wire.end_width, undefined)
  assert.doesNotThrow(() => validate(board))
})

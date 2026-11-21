import { test } from "bun:test"
import assert from "node:assert/strict"
import { inlineVia } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an embedded barrel connects the layers without a standalone via record", async () => {
  const board = await inlineVia()
  assert.ok(
    board.circuit.some(
      (record) =>
        record.type === "pcb_trace" &&
        record.route.some((point) => point.route_type === "via"),
    ),
  )
  // Older saved routes can omit the separate record emitted by current core.
  const circuit = board.circuit.filter((record) => record.type !== "pcb_via")
  assert.doesNotThrow(() => validate({ ...board, circuit }))
})

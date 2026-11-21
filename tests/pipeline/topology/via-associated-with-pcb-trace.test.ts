import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeOnlyViaRing } from "../../fixtures/topology-router-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a via associated with a selected PCB trace supplies its ring dimensions", async () => {
  const board = await routeOnlyViaRing({ gap: 0.1, diameterOnViaRecord: true })
  assert.ok(
    board.circuit.some(
      (record) =>
        record.type === "pcb_via" && record.pcb_trace_id !== undefined,
    ),
  )
  assert.doesNotThrow(() => validate(board))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
import {
  scopeFor,
  scopeNeighbors,
  scopeTrace,
} from "../../../fixtures/copper-scope-board"

test("vias on a retained adjacent route are retained", async () => {
  const { circuit, scope } = await scopeNeighbors()
  assert.equal(
    scope.pcbViaIds.length,
    2,
    "vias on the retained adjacent route are included",
  )
  const adjacent = scopeTrace({ circuit, name: "ADJACENT" })
  assert(adjacent.source_trace_id)
  const vias = new Set(scope.pcbViaIds)
  const sourceLinked = circuit.map((record) => {
    if (record.type !== "pcb_via" || !vias.has(record.pcb_via_id)) return record
    return pcb_via.parse({
      ...record,
      pcb_trace_id: undefined,
      source_trace_id: adjacent.source_trace_id,
    })
  })
  assert.deepEqual(
    scopeFor({ circuit: sourceLinked }).pcbViaIds,
    scope.pcbViaIds,
  )
})

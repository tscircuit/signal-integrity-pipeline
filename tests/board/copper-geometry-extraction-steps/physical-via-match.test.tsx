import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("uses one physical via when its source trace and nearby center match the route", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <CopperTrace
        name="Signal"
        endLayer="inner1"
        points={[
          { x: 4, y: 0, via: true, fromLayer: "top", toLayer: "inner1" },
        ]}
      />
    ),
  })
  const db = cju(circuit)
  const [via] = db.pcb_via.list()
  const [trace] = db.pcb_trace.list()
  assert(via && trace?.source_trace_id)
  // Older producers associate the same TSX route via by its source trace.
  const board = circuit.map((record) => {
    if (record !== via) return record
    const { pcb_trace_id: _, ...physicalVia } = via
    return {
      ...physicalVia,
      x: via.x + 1e-6,
      source_trace_id: trace.source_trace_id,
    }
  })
  const { vias } = extractCopperGeometry({
    circuit: board,
    copperScope: getCopperGeometryExtractionInput({ circuit: board })
      .copperScope,
  })
  assert.deepEqual(
    vias.map(({ pcbViaId, outerDiameterMm }) => [pcbViaId, outerDiameterMm]),
    [[via.pcb_via_id, via.outer_diameter]],
  )
})

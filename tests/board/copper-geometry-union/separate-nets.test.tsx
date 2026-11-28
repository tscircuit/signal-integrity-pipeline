import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("touching wires on separate nets remain separate conductors", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Signal" width={0.3} />
        <CopperTrace name="Other" startY={0.3} width={0.3} net="net.OTHER" />
      </>
    ),
  })
  const db = cju(circuit)
  assert(db.pcb_trace_error.list().length > 0)
  assert.equal(db.pcb_trace.list().length, 2)
  const { wires } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    wires.map(({ pcbTraceId, widthMm }) => [pcbTraceId, widthMm]),
    db.pcb_trace.list().map((trace) => [trace.pcb_trace_id, 0.3]),
  )
  assert(wires.every((wire) => !wire.joins?.length))
})

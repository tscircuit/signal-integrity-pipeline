import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("keeps both contributors to a collinear same-net union", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Long" />
        <CopperTrace name="Short" startX={-2} endX={2} />
      </>
    ),
  })
  const { wires } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  const mergedWire = wires.find(
    ({ startPoint, endPoint }) => startPoint[0] === -2 && endPoint[0] === 2,
  )
  assert(mergedWire)
  assert.deepEqual(
    mergedWire.contributingPcbTraceIds,
    cju(circuit)
      .pcb_trace.list()
      .map(({ pcb_trace_id }) => pcb_trace_id),
  )
  assert.equal(mergedWire.joins?.length, 0)
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("captures mutable board, scope and required ports when constructed", async () => {
  const circuitJson = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
  })
  const input = getCopperGeometryExtractionInput({
    circuit: circuitJson,
    required: ["SignalStart"],
  })
  const copperScope = structuredClone(input.copperScope)
  const extractedPcbTraceIds = [...copperScope.extractedPcbTraceIds]
  const requiredSourcePortIds = [...input.requiredSourcePortIds]
  const solver = new CopperGeometryExtractionSolver({
    ...input,
    circuitJson,
    copperScope: { ...copperScope, extractedPcbTraceIds },
    requiredSourcePortIds,
  })
  const recordCount = circuitJson.length
  circuitJson.length = 0
  extractedPcbTraceIds.length = 0
  requiredSourcePortIds.length = 0
  solver.solve()
  const { value } = solver.getOutput()
  assert.equal(value.circuitJson.length, recordCount)
  assert.equal(value.copperScope.extractedPcbTraceIds.length, 1)
  assert.equal(value.geometry.padContacts.length, 2)
})

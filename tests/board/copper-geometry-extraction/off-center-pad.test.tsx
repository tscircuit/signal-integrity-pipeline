import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("accepts a required pad overlapping the middle of a wire", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Trace" width={0.4} />
        <CopperPad name="Offset" x={0} y={0.3} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit, required: ["Offset"] }),
  )
  assert.doesNotThrow(() => solver.solve())
})

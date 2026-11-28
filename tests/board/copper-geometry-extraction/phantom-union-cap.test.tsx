import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("rejects a pad beyond both physical ends of a merged wire", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Lower" />
        <CopperTrace name="Upper" startY={0.29} width={0.4} />
        <CopperPad name="Open" x={4.42} y={0.195} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit, required: ["Open"] }),
  )
  assert.throws(
    () => solver.solve(),
    /required endpoint .* has no physical wire or via contact/,
  )
})

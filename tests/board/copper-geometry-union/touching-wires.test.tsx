import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("touching same-net wires form one conductor", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Low" width={0.3} />
        <CopperTrace name="High" startY={0.3} width={0.3} />
      </>
    ),
  })
  const { wires } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.equal(wires.length, 1)
  assert.ok(Math.abs(wires[0].widthMm - 0.6) < 1e-7)
  assert.equal(wires[0].joins?.length, 4)
})

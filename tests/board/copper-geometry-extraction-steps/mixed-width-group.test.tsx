import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("groups wires by the furthest edge of the preceding group", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Wide" width={4} />
        <CopperTrace name="Middle" startY={0.5} net="net.OTHER" />
        <CopperTrace name="High" startY={2.2} net="net.OTHER" />
      </>
    ),
  })
  const { sections } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    sections.map(({ wires }) => wires.length),
    [3],
  )
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("keeps nearby rail copper without emitting rail-only sections", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Signal" startX={-1} endX={1} />
        <CopperTrace name="Rail" startY={0.7} net="net.OTHER" />
      </>
    ),
  })
  const { copperScope } = getCopperGeometryExtractionInput({
    circuit,
    railNetName: "OTHER",
  })
  assert.equal(copperScope.nearbyRailPcbTraceIds.length, 1)
  const { wires, sections } = extractCopperGeometry({ circuit, copperScope })
  assert.equal(wires.length, 2)
  assert.deepEqual(
    sections.map(({ startMm, endMm, wires }) => [startMm, endMm, wires.length]),
    [[-1, 1, 2]],
  )
})

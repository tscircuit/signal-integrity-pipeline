import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("coalesces intervals split by an unused reference boundary", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
    reference: (
      <>
        <copperpour connectsTo="net.GND" layer="inner1" unbroken />
        <copperpour
          connectsTo="net.GND"
          layer="bottom"
          unbroken
          outline={[
            { x: -2, y: -1 },
            { x: 2, y: -1 },
            { x: 2, y: 1 },
            { x: -2, y: 1 },
          ]}
        />
      </>
    ),
  })
  const { sections, pours } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.equal(pours.length, 2)
  assert.deepEqual(
    sections.map(({ startMm, endMm, references }) => [
      startMm,
      endMm,
      references[0].layer,
    ]),
    [[-4, 4, "inner1"]],
  )
})

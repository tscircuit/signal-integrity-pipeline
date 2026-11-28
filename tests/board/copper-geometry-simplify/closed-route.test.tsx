import { test } from "bun:test"
import assert from "node:assert/strict"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperPad,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("keeps the three sides of a closed route", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperPad name="Start" x={-3} />
        <trace
          from=".Start > .P"
          to="net.SIGNAL"
          pcbPath={[
            ".Start > .P",
            { x: 2, y: 0 },
            { x: 2, y: 1 },
            { x: 0, y: 0 },
          ]}
        />
      </>
    ),
  })
  const geometry = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    geometry.wires.map(({ startPoint, endPoint }) => [startPoint, endPoint]),
    [
      [
        [-3, 0],
        [-1, 0],
      ],
      [
        [-1, 0],
        [-1, 1],
      ],
      [
        [-1, 1],
        [-3, 0],
      ],
    ],
  )
})

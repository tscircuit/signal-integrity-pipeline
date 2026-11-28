import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("keeps the wire approaching a via on the entry layer", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <CopperTrace
        name="Via"
        endLayer="inner1"
        points={[
          { x: 4, y: 0, via: true, fromLayer: "top", toLayer: "inner1" },
        ]}
      />
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit }),
  )
  solver.solve()
  assert.deepEqual(
    solver
      .getOutput()
      .value.geometry.wires.map(({ layer, startPoint, endPoint }) => [
        layer,
        startPoint,
        endPoint,
      ]),
    [
      ["top", [-4, 0], [0, 0]],
      ["inner1", [0, 0], [4, 0]],
    ],
  )
})

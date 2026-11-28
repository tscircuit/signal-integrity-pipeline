import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("marks an endcap overlapping an off-center same-net pad", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace
          name="Signal"
          width={0.5}
          endY={-2}
          points={[{ x: 4, y: 0 }]}
        />
        <CopperPad name="Offset" x={0} y={0.4} />
      </>
    ),
  })
  const input = getCopperGeometryExtractionInput({
    circuit,
    required: ["Offset"],
  })
  const solver = new CopperGeometryExtractionSolver(input)
  solver.solve()
  const { geometry } = solver.getOutput().value
  const wire = geometry.wires.find(
    ({ endPoint }) => endPoint[0] === 0 && endPoint[1] === 0,
  )
  assert(wire)
  assert.equal(wire.endTouchesPad, true)
})

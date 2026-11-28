import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("does not mark an unrelated pad as a signal wire endpoint", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace
          name="Signal"
          width={0.3}
          endY={-2}
          points={[{ x: 4, y: 0 }]}
        />
        <CopperPad name="Foreign" x={0} net="net.OTHER" />
      </>
    ),
  })
  const input = getCopperGeometryExtractionInput({ circuit })
  const solver = new CopperGeometryExtractionSolver(input)
  solver.solve()
  const { geometry } = solver.getOutput().value
  const wire = geometry.wires.find(
    ({ endPoint }) => endPoint[0] === 0 && endPoint[1] === 0,
  )
  assert(wire)
  assert.equal(wire.endTouchesPad, false)
})

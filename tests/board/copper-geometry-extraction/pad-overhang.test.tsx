import "graphics-debug/matcher"
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperPad,
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("keeps a pad contact beyond the end of a simplified chord", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace
          name="Signal"
          startX={0}
          endX={4}
          points={[{ x: -0.0008, y: 0 }]}
        />
        <CopperPad name="Overhang" x={-0.3004} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit, required: ["Overhang"] }),
  )
  solver.solve()
  const { wires, padContacts } = solver.getOutput().value.geometry
  assert.equal(wires.length, 1)
  assert.deepEqual(wires[0].startPoint, [0, 0])
  assert.equal(wires[0].startTouchesPad, true)
  assert(padContacts.some(({ point }) => point[0] === -0.3004))
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "#ffffff",
  })
})

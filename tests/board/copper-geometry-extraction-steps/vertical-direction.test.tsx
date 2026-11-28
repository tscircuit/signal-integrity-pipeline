import "graphics-debug/matcher"
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("groups near-vertical wires and labels them beside the copper", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Straight" startX={0} endX={0} startY={-3} endY={3} />
        <CopperTrace
          name="Skew"
          startX={0.3}
          endX={0.3 - 1e-7}
          startY={-3}
          endY={3}
          net="net.OTHER"
        />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit }),
  )
  solver.solve()
  const { sections } = solver.getOutput().value.geometry
  assert.deepEqual(
    sections.map(({ wires }) => wires.length),
    [2],
  )
  const label = solver
    .visualize()
    .texts?.find(({ text }) => text.startsWith("top · GND"))
  assert(label)
  assert(label.x < -0.1)
  assert.equal(label.anchorSide, "center_right")
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "#ffffff",
  })
})

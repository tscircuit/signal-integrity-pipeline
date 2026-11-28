import "graphics-debug/matcher"
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("labels a wire on the opposite side of its nearby reference edge", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
    reference: (
      <copperpour
        connectsTo="net.GND"
        layer="inner1"
        unbroken
        outline={[
          { x: -5, y: -1.25 },
          { x: 5, y: -1.25 },
          { x: 5, y: -0.1 },
          { x: -5, y: -0.1 },
        ]}
      />
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit }),
  )
  solver.solve()
  const label = solver
    .visualize()
    .texts?.find(({ text }) => text.startsWith("top · GND edge"))
  assert(label)
  assert(label.y > 0.1)
  assert.equal(label.anchorSide, "bottom_center")
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "#ffffff",
  })
})

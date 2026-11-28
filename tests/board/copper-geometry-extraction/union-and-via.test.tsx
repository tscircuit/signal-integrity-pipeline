import "graphics-debug/matcher"
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("draws a partial union and the wire approaching a via", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Main" width={0.3} startY={1} />
        <CopperTrace
          name="Overlap"
          width={0.4}
          startY={1.3}
          startX={-2}
          endX={2}
        />
        <CopperTrace
          name="Via"
          startY={-2}
          endLayer="inner1"
          points={[
            { x: 4, y: 0, via: true, fromLayer: "top", toLayer: "inner1" },
          ]}
        />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({
      circuit,
      required: ["MainStart", "ViaStart", "ViaEnd"],
    }),
  )
  solver.solve()
  const { wires, vias } = solver.getOutput().value.geometry
  assert(wires.some((wire) => wire.joins?.length === 4))
  assert(vias.some((via) => via.layers.includes("inner1")))
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "#ffffff",
  })
})

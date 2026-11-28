import "graphics-debug/matcher"
import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("uses continuous edge references from two separate pours", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
    reference: (
      <>
        <copperpour
          connectsTo="net.GND"
          layer="inner1"
          unbroken
          outline={[
            { x: -5, y: 0.25 },
            { x: -0.2, y: 0.25 },
            { x: -0.2, y: 1.25 },
            { x: -5, y: 1.25 },
          ]}
        />
        <copperpour
          connectsTo="net.GND"
          layer="inner1"
          unbroken
          outline={[
            { x: 0.2, y: 0.25 },
            { x: 5, y: 0.25 },
            { x: 5, y: 1.25 },
            { x: 0.2, y: 1.25 },
          ]}
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
    sections.map(({ startMm, endMm }) => [startMm, endMm]),
    [
      [-4, 0],
      [0, 4],
    ],
  )
  assert.equal(
    new Set(
      sections.flatMap(({ references }) =>
        references.map(({ pcbCopperPourId }) => pcbCopperPourId),
      ),
    ).size,
    2,
  )
  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "#ffffff",
  })
})

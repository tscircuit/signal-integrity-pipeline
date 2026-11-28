import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { extractCopperGeometry } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("splits the wire section at both antipad vertices on the wire", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Crossing" />
        <cutout
          shape="polygon"
          points={[
            { x: -0.5, y: 0 },
            { x: 0, y: -0.5 },
            { x: 0.5, y: 0 },
            { x: 0, y: 0.5 },
          ]}
        />
      </>
    ),
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const [hole] = pour.brep_shape.inner_rings
  assert(hole?.vertices.length)
  const leftMm = Math.min(...hole.vertices.map(({ x }) => x))
  const rightMm = Math.max(...hole.vertices.map(({ x }) => x))
  const { sections } = extractCopperGeometry({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  assert.deepEqual(
    sections.map(({ startMm, endMm }) => [startMm, endMm]),
    [
      [-4, leftMm],
      [leftMm, rightMm],
      [rightMm, 4],
    ],
  )
  assert.equal(sections[0].references[0].lateralGapMm, undefined)
  assert.ok(sections[1].references[0].lateralGapMm)
  assert.equal(sections[2].references[0].lateralGapMm, undefined)
})

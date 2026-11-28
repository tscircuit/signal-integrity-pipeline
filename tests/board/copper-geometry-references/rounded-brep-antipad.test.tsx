import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { normalizeReferencePour } from "../../../src/board/copper-geometry-references"
import {
  CopperTrace,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("preserves a rounded antipad encoded with BRep arcs", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Crossing" startY={0.3} />
        <cutout shape="circle" radius={0.5} />
      </>
    ),
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const [hole] = pour.brep_shape.inner_rings
  assert(hole?.vertices.length)
  // Core tessellates the circular cutout. Encode the same radius as two arcs.
  const radiusMm = Math.max(...hole.vertices.map(({ y }) => Math.abs(y)))
  assert(radiusMm > 0.3)
  const [reference] = normalizeReferencePour({
    ...pour,
    brep_shape: {
      ...pour.brep_shape,
      inner_rings: [
        {
          vertices: [
            { x: -radiusMm, y: 0, bulge: 1 },
            { x: radiusMm, y: 0, bulge: 1 },
          ],
        },
      ],
    },
  })
  assert(reference)
  const [, antipad] = reference.polygon
  assert(antipad.length > 2)
  assert.equal(Math.max(...antipad.map(([, y]) => Math.abs(y))), radiusMm)
})

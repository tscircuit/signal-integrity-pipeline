import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { normalizeReferencePour } from "../../../src/board/copper-geometry-references"
import {
  CopperTrace,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("omits a BRep pour with no surviving edges", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const { outer_ring } = pour.brep_shape
  assert.deepEqual(
    normalizeReferencePour({
      ...pour,
      brep_shape: {
        inner_rings: [],
        outer_ring: { vertices: outer_ring.vertices.slice(0, 1) },
      },
    }),
    [],
  )
})

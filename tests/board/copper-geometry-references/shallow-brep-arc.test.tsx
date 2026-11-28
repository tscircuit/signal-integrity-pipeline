import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { normalizeReferencePour } from "../../../src/board/copper-geometry-references"
import {
  CopperTrace,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

/** Core emits polygonized boundaries. Encode a shallow arc on one emitted edge. */
async function normalizeShallowArc(): Promise<void> {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const { outer_ring } = pour.brep_shape
  const [start, ...vertices] = outer_ring.vertices
  const [reference] = normalizeReferencePour({
    ...pour,
    brep_shape: {
      ...pour.brep_shape,
      outer_ring: { vertices: [{ ...start, bulge: 1e-13 }, ...vertices] },
    },
  })
  assert(reference)
  assert.equal(reference.polygon[0].length, outer_ring.vertices.length)
}

if (process.argv.includes("--normalize-shallow-arc")) {
  await normalizeShallowArc()
} else {
  test("normalizes a shallow BRep arc without unbounded sampling", async () => {
    const child = Bun.spawn(
      [process.execPath, import.meta.path, "--normalize-shallow-arc"],
      {
        timeout: 4000,
        killSignal: "SIGKILL",
        stderr: "pipe",
      },
    )
    const error = await new Response(child.stderr).text()
    assert.equal(await child.exited, 0, error)
  })
}

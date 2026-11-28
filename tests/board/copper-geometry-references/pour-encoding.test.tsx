import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import type { PcbCopperPour } from "circuit-json"
import { normalizeReferencePour } from "../../../src/board/copper-geometry-references"
import {
  CopperTrace,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("normalizes equivalent rectangular, polygon and BRep reference pours", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
  })
  const [pour] = cju(circuit).pcb_copper_pour.list()
  assert(pour?.shape === "brep")
  const { brep_shape, ...pourFields } = pour
  const points = brep_shape.outer_ring.vertices
  const minX = Math.min(...points.map(({ x }) => x))
  const maxX = Math.max(...points.map(({ x }) => x))
  const minY = Math.min(...points.map(({ y }) => y))
  const maxY = Math.max(...points.map(({ y }) => y))
  const alternatives: PcbCopperPour[] = [
    { ...pourFields, shape: "polygon", points },
    {
      ...pourFields,
      shape: "rect",
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
    },
    pour,
  ]
  for (const alternative of alternatives) {
    const [reference] = normalizeReferencePour(alternative)
    assert(reference)
    assert.equal(reference.pcbCopperPourId, pour.pcb_copper_pour_id)
    assert.deepEqual(
      reference.polygon[0].toSorted(([ax, ay], [bx, by]) => ax - bx || ay - by),
      points
        .map(({ x, y }) => [x, y])
        .sort(([ax, ay], [bx, by]) => ax - bx || ay - by),
    )
  }
})

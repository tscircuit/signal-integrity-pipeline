import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("marks pad contacts on a shifted union centerline", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="Low" />
        <CopperTrace name="High" startY={0.3} width={0.4} />
      </>
    ),
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({
      circuit,
      required: ["LowStart", "HighEnd"],
    }),
  )
  solver.solve()
  const { wires } = solver.getOutput().value.geometry
  assert.equal(wires.length, 1)
  assert.equal(wires[0].startTouchesPad, true)
  assert.equal(wires[0].endTouchesPad, true)
})

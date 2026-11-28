import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("publishes the immutable circuit and copper scope supplied by planning", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
  })
  const input = getCopperGeometryExtractionInput({ circuit })
  const solver = new CopperGeometryExtractionSolver(input)
  solver.solve()
  const produced = solver.getOutput()
  assert.equal(produced.value.circuitJson, input.circuitJson)
  assert.equal(produced.value.copperScope, input.copperScope)
  assert(Object.isFrozen(produced))
  assert(Object.isFrozen(produced.artifacts))
  assert(produced.artifacts.every((artifact) => Object.isFrozen(artifact)))
})

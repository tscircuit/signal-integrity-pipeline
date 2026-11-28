import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("rejects a taper on the outgoing wire point", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Taper" hasStartTeardrop />,
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit }),
  )
  assert.throws(() => solver.solve(), /tapered routes/)
})

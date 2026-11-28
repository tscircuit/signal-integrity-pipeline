import { test } from "bun:test"
import assert from "node:assert/strict"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("declares the frozen copper geometry fields readonly", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
  })
  const solver = new CopperGeometryExtractionSolver(
    getCopperGeometryExtractionInput({ circuit }),
  )
  solver.solve()
  const { value: copperGeometry } = solver.getOutput()
  assert.throws(() => {
    // @ts-expect-error The published circuit is readonly.
    copperGeometry.circuitJson = []
  }, TypeError)
  assert.throws(() => {
    // @ts-expect-error The published scope is readonly.
    copperGeometry.copperScope = { ...copperGeometry.copperScope }
  }, TypeError)
  assert.throws(() => {
    // @ts-expect-error The extracted geometry is readonly.
    copperGeometry.geometry = { ...copperGeometry.geometry }
  }, TypeError)
  assert.throws(() => {
    // @ts-expect-error The published mask thickness is readonly.
    copperGeometry.maskThicknessMm = null
  }, TypeError)
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { stepCopperGeometryExtraction } from "../../../src/board"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

test("earlier extraction progress does not change after the next trace", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="First" />
        <CopperTrace name="Second" startY={0.6} />
      </>
    ),
  })
  const steps = stepCopperGeometryExtraction({
    circuit,
    copperScope: getCopperGeometryExtractionInput({ circuit }).copperScope,
  })
  const first = steps.next()
  assert.equal(first.done, false)
  const report = JSON.stringify(first.value)
  steps.next()
  assert.equal(JSON.stringify(first.value), report)
})

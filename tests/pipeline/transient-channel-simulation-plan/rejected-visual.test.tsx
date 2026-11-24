import { test } from "bun:test"
import assert from "node:assert/strict"
import { admissionColors } from "../../../src/board"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import {
  assertRouteVisual,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("rejected admission carries a visible red reason without inventing an admitted channel simulation", async () => {
  const { root } = await routedVisualFixture()
  const solver = new RoutedAdmissionSolver({
    ...root.inputProblem,
    scopeDistanceMm: 0,
  })
  assert.throws(() => solver.solve(), /scope distance/)
  const drawing = solver.visualize()
  const reason = drawing.texts?.find((text) =>
    text.text.includes("scope distance"),
  )
  assert.equal(reason?.color, admissionColors.failure)
  assert.ok(drawing.texts?.every((text) => text.anchorSide === "center"))
  assert.match(drawing.title || "", /^ADMISSION FAILED$/)
  assertRouteVisual({
    drawing,
    module: "pipeline",
    name: "routed-admission-rejected",
  })
})

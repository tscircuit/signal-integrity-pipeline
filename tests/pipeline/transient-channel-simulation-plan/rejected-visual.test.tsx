import assert from "node:assert/strict"
import { routeTones } from "../../../src/board"
import { test } from "bun:test"
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
  assert.ok(
    drawing.texts!.every((text) => text.color === routeTones.failure),
    "only the red reason is written",
  )
  assert.match(
    drawing.texts!.map((text) => text.text).join(" "),
    /scope distance/,
  )
  assertRouteVisual({
    drawing,
    module: "pipeline",
    name: "routed-admission-rejected",
  })
})

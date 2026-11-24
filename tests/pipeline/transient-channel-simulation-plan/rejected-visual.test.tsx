import { test } from "bun:test"
import assert from "node:assert/strict"
import { planColors } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import {
  assertRouteVisual,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("rejected plan carries a visible red reason without inventing a planned channel simulation", async () => {
  const { root } = await routedVisualFixture()
  const solver = new TransientChannelSimulationPlanSolver({
    ...root.inputProblem,
    scopeDistanceMm: 0,
  })
  assert.throws(() => solver.solve(), /scope distance/)
  const drawing = solver.visualize()
  const reason = drawing.texts?.find(
    (text) =>
      text.text === "Choose a copper search distance greater than zero.",
  )
  assert.equal(reason?.color, planColors.failure)
  assert.ok(drawing.texts?.every((text) => text.anchorSide === "center"))
  assert.equal(drawing.title, "Simulation — can't simulate")
  assert.ok(
    drawing.rects?.some((rect) =>
      rect.label?.includes("Copper scope distance must be finite and positive"),
    ),
  )
  assertRouteVisual({
    drawing,
    module: "pipeline",
    name: "transient-channel-simulation-plan-rejected",
  })
})

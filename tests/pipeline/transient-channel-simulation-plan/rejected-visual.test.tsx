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
    (text) => text.text === "Copper search distance must be greater than 0 mm.",
  )
  assert.equal(reason?.color, planColors.failure)
  assert.ok(drawing.texts?.every((text) => text.anchorSide === "center"))
  assert.equal(drawing.title, "Plan: can't simulate")
  assert.ok(
    drawing.rects?.some((rect) =>
      rect.label?.includes("Copper scope distance must be finite and positive"),
    ),
  )
  assertRouteVisual({
    drawing,
    module: "pipeline",
    name: "transient-channel-simulation-plan-rejected",
    caption:
      "Two parallel traces connect TX0 to RX0 and TX1 to RX1. This test sets the copper search distance to 0 mm and checks that the plan stops.",
  })
})

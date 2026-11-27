import { test } from "bun:test"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
  twoTracePlanCaption,
} from "../../fixtures/routed-visual"

test("two-trace TSX transient-channel-simulation-plan visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertPlanDrawingSnapshot({
    drawing: root.visualizeStage(1),
    caption: twoTracePlanCaption,
    module: "pipeline",
    name: "transient-channel-simulation-plan",
  })
})

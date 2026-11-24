import { test } from "bun:test"
import {
  assertRouteVisual,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("two-trace TSX transient-channel-simulation-plan visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual({
    drawing: root.visualizeStage(1),
    module: "pipeline",
    name: "transient-channel-simulation-plan",
  })
})

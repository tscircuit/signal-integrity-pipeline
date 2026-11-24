import { test } from "bun:test"
import {
  assertRouteVisual,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("two-trace TSX routed-admission visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual({
    drawing: root.visualizeStage(1),
    module: "pipeline",
    name: "routed-admission",
  })
})

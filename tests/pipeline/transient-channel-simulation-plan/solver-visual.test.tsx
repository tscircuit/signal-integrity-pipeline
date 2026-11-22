import { test } from "bun:test"
import { RoutedAdmissionSolver } from "../../../src/pipeline"
import {
  assertRouteVisual,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("two-trace TSX routed-admission visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual({
    drawing: root
      .getSolver<RoutedAdmissionSolver>("RoutedAdmissionSolver")!
      .visualize(),
    module: "pipeline",
    name: "routed-admission",
  })
})

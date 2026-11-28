import { test } from "bun:test"
import type { CopperGeometryExtractionSolver } from "../../../src/board"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("two-trace TSX copper-geometry-extraction visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertPlanDrawingSnapshot({
    drawing: root
      .getSolver<CopperGeometryExtractionSolver>(
        "CopperGeometryExtractionSolver",
      )!
      .visualize(),
    module: "board",
    name: "copper-geometry-extraction",
  })
})

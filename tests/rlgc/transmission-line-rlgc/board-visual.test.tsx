import { test } from "bun:test"
import type { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("two-trace TSX transmission-line-rlgc visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertPlanDrawingSnapshot({
    drawing: root
      .getSolver<TransmissionLineRlgcSolver>("TransmissionLineRlgcSolver")!
      .visualize(),
    module: "rlgc",
    name: "transmission-line-rlgc",
  })
})

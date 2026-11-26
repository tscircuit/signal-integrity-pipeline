import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("summarizes a receiver path that exceeds the detailed row limit", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential seriesPositive allowUnroutedTraces />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  assert.equal(
    solver.getOutput().value[0].bindings.receiverPaths[0].sourceTraceIds
      ?.length,
    5,
  )
  const drawing = solver.visualize()
  assert.ok(
    drawing.texts?.some(({ text }) =>
      text.includes("BUS+: TX pin A → RX pin A (5 traces,"),
    ),
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "compact-path-visual",
    caption:
      "BUS+ crosses five routed traces and four series resistors. The header summarizes that receiver path in one row.",
  })
})

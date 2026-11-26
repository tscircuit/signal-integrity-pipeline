import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("draws a board-level diagnostic when an unused IBIS source cannot be hashed", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  const ibisSources = { [inverterModelPath]: routedVisualIbis }
  Reflect.set(ibisSources, "models/unused.ibs", false)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources,
  })
  assert.throws(() => solver.solve(), { code: "ibis_asset" })
  const drawing = solver.visualize()
  assert.equal(drawing.title, "Plan: can't simulate")
  assert.ok(
    drawing.rects?.some(({ label }) => label?.includes("models/unused.ibs")),
  )
})

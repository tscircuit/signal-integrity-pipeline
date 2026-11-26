import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("draws a diagnostic after the Circuit JSON schema rejects the board", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  Reflect.set(circuitJson, circuitJson.length, null)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), { code: "circuit_schema" })
  const drawing = solver.visualize()
  assert.equal(drawing.title, "Plan: can't simulate")
  assert.ok(
    drawing.rects?.some(({ label }) =>
      label?.includes("registered record schema"),
    ),
  )
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("sectioning and binding share one board in a frozen output", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const output = solver.getOutput()
  const { value, artifacts } = output
  const [plan] = value
  assert.ok(plan.sections.circuitJson === plan.bindings.circuitJson)
  assert.ok(Object.isFrozen(value))
  assert.ok(Object.isFrozen(output))
  assert.ok(Object.isFrozen(artifacts))
  assert.ok(Object.isFrozen(artifacts[0]))
})

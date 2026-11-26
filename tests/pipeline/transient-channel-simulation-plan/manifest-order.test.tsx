import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("manifest bytes do not depend on the order of supplied model paths", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const entries = [
    [inverterModelPath, routedVisualIbis],
    ["models/unused.ibs", "| unused fixture"],
  ]
  const first = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: Object.fromEntries(entries),
  })
  const second = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: Object.fromEntries(entries.toReversed()),
  })
  first.solve()
  second.solve()
  assert.deepEqual(first.getOutput().artifacts, second.getOutput().artifacts)
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { expectPlanPcbSnapshot } from "../../fixtures/plan-pcb-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("routed differential terminations stay electrically distinct", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential routedTermination />,
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { requiredSourcePortIds } = plan.sections
  assert.equal(requiredSourcePortIds.length, 6)
  assert.equal(new Set(requiredSourcePortIds).size, 6)
  expectPlanPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 4,
    testPath: import.meta.path,
  })
})

import { test } from "bun:test"
import { cju } from "@tscircuit/circuit-json-util"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { resolvePlanTraces } from "../../fixtures/plan-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("redundant named nets do not short routed series segments", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="series" namedNets />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  resolvePlanTraces({
    db: cju([...circuitJson]),
    plan: solver.getOutput().value[0],
    expectedTraceCount: 2,
  })
})

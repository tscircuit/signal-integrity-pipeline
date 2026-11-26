import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("derives unique trace contacts from named receiver paths", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg idealMiddleLeg namedNet />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  assert.equal(bindings.receiverPaths.length, 2)
  assert.equal(bindings.receiverPaths[1].sourceTraceIds?.length, 2)
  const { node } = circuitNodes({
    circuit: cloneCircuitJson(bindings.circuitJson),
    modeling: bindings.modeling,
    receiverPaths: bindings.receiverPaths,
  })
  assert.equal(new Set(plan.sections.requiredSourcePortIds.map(node)).size, 3)
})

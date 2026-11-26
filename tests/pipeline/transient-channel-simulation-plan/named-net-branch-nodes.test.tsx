import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { expectPlanPcbSnapshot } from "../../fixtures/plan-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a named path leaves a separate unlabeled branch trace intact", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg idealMiddleLeg namedNet branched />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  assert.equal(bindings.traceContacts.length, 3)
  assert.equal(new Set(plan.sections.requiredSourcePortIds.map(node)).size, 4)
  expectPlanPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 3,
    testPath: import.meta.path,
    caption: "The unlabeled branch shares the ideal junction with DATA",
  })
  assert.deepEqual(
    bindings.receiverPaths.map(({ sourceTraceIds }) => sourceTraceIds?.length),
    [undefined, 2, 2],
  )
})

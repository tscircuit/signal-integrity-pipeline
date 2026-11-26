import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson, selectPort } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { expectPlanPcbSnapshot } from "../../fixtures/plan-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("an ideal connection can join successive traces on one partial receiver path", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg idealMiddleLeg />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const middlePort = selectPort({
    circuit: circuitJson,
    selector: { component: "MID", port: "A" },
  })
  const junctionPort = selectPort({
    circuit: circuitJson,
    selector: { component: "JOIN", port: "A" },
  })
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  const middleNode = node(middlePort.source_port_id)
  assert.equal(middleNode, node(junctionPort.source_port_id))
  assert.equal(bindings.receiverPaths[1]?.sourceTraceIds?.length, 2)
  expectPlanPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 2,
    testPath: import.meta.path,
    caption: `MID.A and JOIN.A share ${middleNode} on the ideal leg`,
  })
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { expectPlanPcbSnapshot } from "../../fixtures/plan-pcb-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a one-trace receiver path preserves both physical contacts", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="receiver-only" namedNets />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const [contacts] = bindings.traceContacts
  const [receiverPath] = bindings.receiverPaths
  assert.equal(receiverPath.sourceTraceId, contacts.sourceTraceId)
  assert.notEqual(receiverPath.fromSourcePortId, contacts.fromSourcePortId)
  expectPlanPcbSnapshot({
    circuitJson,
    plan,
    expectedTraceCount: 1,
    testPath: import.meta.path,
    caption: "Only the receiver segment is routed",
  })
  const { node } = circuitNodes({
    circuit: cloneCircuitJson(bindings.circuitJson),
    receiverPaths: bindings.receiverPaths,
    modeling: bindings.modeling,
  })
  assert.notEqual(
    node(contacts.fromSourcePortId),
    node(contacts.toSourcePortId),
  )
})

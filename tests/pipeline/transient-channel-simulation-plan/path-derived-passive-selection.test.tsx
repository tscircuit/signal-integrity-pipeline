import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { generalDeclarations } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("receiver paths without explicit trace contacts require the selected model for trace contacts", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="receiver-only" namedNets />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const {
    traceContacts,
    circuitJson: plannedCircuitJson,
    receiverPaths,
    controls,
  } = bindings
  const circuit = cloneCircuitJson(plannedCircuitJson)
  const modeling = { ...bindings.modeling, passiveComponents: [] }
  const error = {
    domain: "simulation",
    code: "channel_model",
    message: /RS has no selected deck model/,
  }
  assert.throws(
    () =>
      generalDeclarations({
        circuit,
        controls,
        modeling,
        receiverPaths,
        traceContacts,
      }),
    error,
  )
  assert.throws(
    () => generalDeclarations({ circuit, controls, modeling, receiverPaths }),
    error,
  )
})

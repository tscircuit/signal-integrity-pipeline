import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("rejects a grounded driver beyond the first physical trace", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="receiver-only" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const [receiverPath] = bindings.receiverPaths
  assert.equal(bindings.traceContacts.length, 1)
  assert.ok(receiverPath)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
        modeling: {
          ...bindings.modeling,
          channelReference: { sourcePortId: receiverPath.fromSourcePortId },
        },
      }),
    { domain: "simulation", code: "channel_short", message: /ground/ },
  )
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a wholly ideal single-ended channel still rejects a grounded signal contact", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="unrouted" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const [{ driver }] = cju(
    cloneCircuitJson(bindings.circuitJson),
  ).simulation_pcb_driver_receiver_channel.list()
  assert.ok("source_port_id" in driver)
  assert.deepEqual(bindings.receiverPaths, [])
  assert.deepEqual(bindings.traceContacts, [])
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
        modeling: {
          ...bindings.modeling,
          channelReference: { sourcePortId: driver.source_port_id },
        },
      }),
    {
      domain: "simulation",
      code: "channel_short",
      message: new RegExp(`${driver.source_port_id}.*ground`),
    },
  )
})

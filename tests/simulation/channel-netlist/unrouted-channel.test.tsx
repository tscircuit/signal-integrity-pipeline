import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { planNetlistChannels } from "../../fixtures/channel-netlist"
import { renderSignals } from "../../fixtures/signal-render"

test("binds the driver and receiver of an allowed unrouted channel to one node", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="unrouted" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const [{ bindings }] = planNetlistChannels({ circuitJson })
  assert.deepEqual(bindings.traceContacts, [])
  const solver = new ChannelNetlistSolver(bindings)
  solver.solve()

  const [
    {
      driver,
      receivers: [receiver],
    },
  ] = cju(circuitJson).simulation_pcb_driver_receiver_channel.list()
  assert.ok("source_port_id" in driver && "source_port_id" in receiver)
  const { nodeMap } = solver.getOutput().value
  const driverNode = nodeMap[driver.source_port_id]
  assert.ok(driverNode)
  assert.notEqual(driverNode, "0")
  assert.equal(nodeMap[receiver.source_port_id], driverNode)
})

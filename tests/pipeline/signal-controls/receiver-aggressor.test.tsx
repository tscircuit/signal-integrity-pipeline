import { test } from "bun:test"
import assert from "node:assert/strict"
import { endpointPorts } from "../../../src/board"
import { ParallelBus, parallelBusSources } from "../../fixtures/parallel-bus"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("a bidirectional receiver needs and uses the declared aggressor state", async () => {
  const circuit = await renderSignals({
    tree: <ParallelBus neighbourPattern="1" />,
  })
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: parallelBusSources }),
    /Aggressors RX[.]DQ0 need a declared state/,
  )

  const drivenCircuit = await renderSignals({
    tree: <ParallelBus neighbourPattern="1" aggressorPattern="0" />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit: drivenCircuit,
    sources: parallelBusSources,
  })
  const [data] = prepared.driverReceiverChannels
  const [port] = endpointPorts(data.receivers[0])
  const { states, stimuli } =
    prepared.controls[
      prepared.channelSimulation.simulation_pcb_transient_channel_simulation_id
    ]
  assert.equal(prepared.pins.get(port)?.buffer.type, "i/o")
  assert.deepEqual(
    states.find((state) => state.source_port_id === port),
    { source_port_id: port, is_output: true, is_output_enabled: true },
  )
  assert.equal(
    stimuli.find((stimulus) => stimulus.source_port_id === port)
      ?.transmission_pattern.bits,
    "0",
  )
})

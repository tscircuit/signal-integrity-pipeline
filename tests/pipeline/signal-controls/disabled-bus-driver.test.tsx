import { test } from "bun:test"
import assert from "node:assert/strict"
import { endpointPorts } from "../../../src/board"
import { ParallelBus, parallelBusSources } from "../../fixtures/parallel-bus"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("a bus driver with output explicitly disabled gets no stimulus", async () => {
  const circuit = await renderSignals({
    tree: <ParallelBus driverDisabled aggressorPattern="0" />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: parallelBusSources,
  })
  const [data] = prepared.driverReceiverChannels
  const [port] = endpointPorts(data.driver)
  assert.equal(data.driver_disabled, true)
  const { states, stimuli } =
    prepared.controls[
      prepared.channelSimulation.simulation_pcb_transient_channel_simulation_id
    ]
  assert.deepEqual(
    states.find((state) => state.source_port_id === port),
    {
      source_port_id: port,
      is_output: true,
      is_output_enabled: false,
    },
  )
  assert.equal(
    stimuli.some((stimulus) => stimulus.source_port_id === port),
    false,
  )
})

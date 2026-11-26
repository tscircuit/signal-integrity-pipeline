import { test } from "bun:test"
import assert from "node:assert/strict"
import { endpointPorts } from "../../../src/board"
import { ParallelBus, parallelBusSources } from "../../fixtures/parallel-bus"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("retains a same-chip bus neighbor and uses its declared constant-high pattern", async () => {
  const unlisted = await renderSignals({
    tree: <ParallelBus aggressorPattern="0" />,
  })
  const [unlistedNeighbor] = prepareChannelSimulations({
    circuit: unlisted,
    sources: parallelBusSources,
  })
  assert.equal(unlistedNeighbor.driverReceiverChannels.length, 1)
  const neighbor = [...unlistedNeighbor.pins.values()].find(
    (pin) => pin.pin === "2" && pin.buffer.type === "output",
  )
  assert.ok(neighbor)

  const declared = await renderSignals({
    tree: <ParallelBus neighbourPattern="1" aggressorDisabled />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit: declared,
    sources: parallelBusSources,
  })
  const [data, quiet] = prepared.driverReceiverChannels
  const [dataPort] = endpointPorts(data.driver)
  const [quietPort] = endpointPorts(quiet.driver)
  assert.equal(
    prepared.pins.get(quietPort)?.model,
    prepared.pins.get(dataPort)?.model,
  )
  const controls =
    prepared.controls[
      prepared.channelSimulation.simulation_pcb_transient_channel_simulation_id
    ]
  const stimulus = controls.stimuli.find(
    (stimulus) => stimulus.source_port_id === quietPort,
  )
  assert.ok(stimulus)
  assert.equal(stimulus.initial_state, 1)
  assert.equal(stimulus.transmission_pattern.bits, "1")
})

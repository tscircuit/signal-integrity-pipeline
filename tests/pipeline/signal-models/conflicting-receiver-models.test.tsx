import { test } from "bun:test"
import assert from "node:assert/strict"
import { endpointPorts } from "../../../src/board"
import {
  ReceiverModels,
  receiverModelSources,
} from "../../fixtures/receiver-models"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("rejects two IBIS model selections for one receiver port", async () => {
  const circuit = await renderSignals({
    tree: <ReceiverModels secondModel="AlternateInput" />,
  })
  const channel = circuit.find(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  assert.ok(channel)
  const [receiver, duplicate] = channel.receivers
  const [port] = endpointPorts(receiver)
  assert.deepEqual(endpointPorts(duplicate), [port])
  assert.throws(
    () => prepareChannelSimulations({ circuit, sources: receiverModelSources }),
    {
      message: `Conflicting IBIS models for source port ${port}: "LVC1G04_IN_33" and "AlternateInput".`,
    },
  )
})

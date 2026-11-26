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

test("accepts the same IBIS model twice for one receiver port", async () => {
  const circuit = await renderSignals({
    tree: <ReceiverModels secondModel="LVC1G04_IN_33" />,
  })
  const [prepared] = prepareChannelSimulations({
    circuit,
    sources: receiverModelSources,
  })
  const [receiver] = prepared.driverReceiverChannels[0].receivers
  const [port] = endpointPorts(receiver)
  assert.equal(prepared.pins.get(port)?.buffer.name, "LVC1G04_IN_33")
})

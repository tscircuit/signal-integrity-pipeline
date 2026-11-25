import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import type { CircuitJson } from "../../../src/board"
import { Four, readSignalApiModels } from "../../fixtures/signal-api"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("four-conductor derivation is invariant under signal record order", async () => {
  const circuit = await renderSignals({ tree: <Four /> })
  const ibis = await readSignalApiModels()
  const a = prepareChannelSimulations({ circuit, sources: ibis })[0]
  const channels = cju(circuit).simulation_pcb_driver_receiver_channel.list()
  const channelRecords = new Set<CircuitJson[number]>(channels)
  const otherRecords = circuit.filter((record) => !channelRecords.has(record))
  const b = prepareChannelSimulations({
    circuit: [...otherRecords, ...channels.reverse()],
    sources: ibis,
  })[0]
  assert.equal(a.settings.traceContacts.length, 4)
  assert.deepEqual(a.settings, b.settings)
})

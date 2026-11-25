import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { readSignalApiModels } from "../../fixtures/signal-api"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("derives the differential identity and termination", async () => {
  const circuit = await renderSignals({ tree: <Differential /> })
  const ibis = await readSignalApiModels()
  const prepared = prepareChannelSimulations({ circuit, sources: ibis })[0]
  const receiver = prepared.driverReceiverChannels[0].receivers[0]
  assert.ok("p_source_port_id" in receiver)
  if (!("p_source_port_id" in receiver)) return
  const [resistor] = cju(circuit).source_component.list({ name: "RTERM" })
  assert.ok(resistor)
  assert.ok(
    prepared.settings.passiveComponents?.some(
      (p) => p.sourceComponentId === resistor.source_component_id,
    ),
  )
  const reversed = await renderSignals({ tree: <Differential reversed /> })
  assert.throws(
    () => prepareChannelSimulations({ circuit: reversed, sources: ibis }),
    /Signal "BUS": differential pin order disagrees with IBIS/,
  )
})

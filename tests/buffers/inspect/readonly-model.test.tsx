import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { inspectPins } from "../../../src/buffers"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import {
  prepareChannelSimulations,
  renderSignals,
} from "../../fixtures/signal-render"

test("pin inspection exposes the borrowed IBIS declaration as readonly", async () => {
  const circuit = await renderSignals({
    tree: <ChannelFixture route="series" />,
  })
  const db = cju([...circuit])
  for (const model of db.simulation_ibis_model.list())
    Object.freeze(model.ibis_pin_name_to_source_port_id)
  const [{ driver }] = db.simulation_pcb_driver_receiver_channel.list()
  assert.ok("source_port_id" in driver)
  const pins = inspectPins({
    circuit,
    sources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
    ports: new Set([driver.source_port_id]),
  })
  const pin = pins.get(driver.source_port_id)
  assert.ok(pin)
  const [{ pins: preparedPins }] = prepareChannelSimulations({
    circuit,
    sources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  const preparedPin = preparedPins.get(driver.source_port_id)
  assert.ok(preparedPin)
  assert.throws(() => {
    // @ts-expect-error The returned declaration has a deeply readonly pin map.
    pin.model.ibis_pin_name_to_source_port_id[pin.pin] = "changed"
  }, TypeError)
  assert.equal(
    Reflect.set(preparedPin.model, "ibis_component_name", "changed"),
    false,
  )
})

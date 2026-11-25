import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { Four } from "../../fixtures/signal-api"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"
import Single from "../../fixtures/unit-single-ended"

test("Real core renders source records and core-owned stackup without loading vendor assets", async () => {
  for (const Board of [Single, Differential, Four]) {
    const records = await renderSignals({ tree: <Board /> })
    const db = cju(records)
    assert.equal(db.pcb_stackup.list().length, 1)
    assert.ok(db.simulation_pcb_driver_receiver_channel.list().length)
    assert.equal(db.simulation_experiment.list().length, 0)
    assert.equal(db.simulation_voltage_probe.list().length, 0)
  }
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { categorizeCopper } from "../../site/channel-inspector/copper"
import {
  loadInspectorSample,
  sampleScopeDistanceMm,
} from "../../site/channel-inspector/sample"
import { listChannelSimulations } from "../../src/pipeline/signals"
import { scopeTrace } from "../fixtures/copper-scope-board"

test("channel inspector distinguishes a declared trace, its neighbor and a spare", async () => {
  const circuit = await loadInspectorSample()
  const db = cju([...circuit])
  const [simulation] = listChannelSimulations(circuit)
  const [channel] = db.simulation_pcb_driver_receiver_channel.list()
  assert.ok("source_port_id" in channel.driver)
  const driverPort = channel.driver.source_port_id
  const source = db.source_trace
    .list()
    .find((trace) => trace.connected_source_port_ids.includes(driverPort))
  assert.ok(source)
  const selected = db.pcb_trace.getWhere({
    source_trace_id: source.source_trace_id,
  })
  assert.ok(selected)
  const spare = scopeTrace({ circuit, name: "SPARE" })
  const near = db.pcb_trace
    .list()
    .find(
      (trace) =>
        trace.pcb_trace_id !== selected.pcb_trace_id &&
        trace.pcb_trace_id !== spare.pcb_trace_id,
    )
  assert.ok(near)
  const { copper } = categorizeCopper({
    circuit,
    simulation,
    distanceMm: sampleScopeDistanceMm,
  })
  const categories = new Map(copper.map(({ id, category }) => [id, category]))
  assert.equal(categories.get(selected.pcb_trace_id), "selected")
  assert.equal(categories.get(near.pcb_trace_id), "near")
  assert.equal(categories.get(spare.pcb_trace_id), "far")
  for (const { pcb_copper_pour_id } of db.pcb_copper_pour.list())
    assert.equal(categories.get(pcb_copper_pour_id), "rail")
})

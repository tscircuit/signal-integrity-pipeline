import { expect, test } from "bun:test"
import { cju } from "@tscircuit/circuit-json-util"
import { categorizeCopper } from "../../site/channel-inspector/copper"
import { loadInspectorSample } from "../../site/channel-inspector/sample"
import { editNetRole, netRoles } from "../../site/workbench/model/net-roles"

test("net role edits promote a modeled nearby trace to a victim and preserve the loaded design", async () => {
  const circuit = await loadInspectorSample()
  const db = cju([...circuit])
  const simulation = db.simulation_pcb_transient_channel_simulation.getWhere(
    {},
  )!
  const scope = categorizeCopper({ circuit, simulation, distanceMm: 1 })
  const near = scope.copper.find(({ category }) => category === "near")!
  if (near.record.type !== "pcb_trace") throw new Error("Expected a trace")
  const edited = editNetRole({
    circuit,
    simulation,
    trace: near.record,
    role: "selected",
  })
  const promoted = cju([
    ...edited,
  ]).simulation_pcb_transient_channel_simulation.getWhere({})!
  expect(netRoles(promoted)[near.id]).toBe("selected")
  expect(
    categorizeCopper({
      circuit: edited,
      simulation: promoted,
      distanceMm: 1,
    }).copper.find(({ id }) => id === near.id)?.category,
  ).toBe("selected")
  expect(db.simulation_pcb_driver_receiver_channel.list()).toHaveLength(1)
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"

test("marks the netlist failed when conversion fails after the first model", async () => {
  const input = await renderTwoTraceNetlistInput()
  const [, secondModel] = input.circuitJson.filter(
    (record) => record.type === "simulation_ibis_model",
  )
  assert.ok(secondModel)
  const solver = new ChannelNetlistSolver({
    ...input,
    circuitJson: input.circuitJson.map((record) => {
      if (record !== secondModel) return record
      return { ...secondModel, ibis_component_name: "Unmapped" }
    }),
  })
  solver.step()
  assert.equal(solver.stats.models, 1)
  assert.equal(solver.failed, false)
  assert.throws(() => solver.step(), { code: "missing_component" })
  assert.equal(solver.failed, true)
  assert.throws(() => solver.getOutput(), /netlist is incomplete/)
})

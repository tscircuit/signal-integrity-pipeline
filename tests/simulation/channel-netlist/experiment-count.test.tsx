import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"

test("requires exactly one lowered experiment for binding", async () => {
  const input = await renderTwoTraceNetlistInput()
  const experiment = input.circuitJson.find(
    (record) => record.type === "simulation_experiment",
  )
  assert.ok(experiment)
  const duplicate = {
    ...experiment,
    simulation_experiment_id: `${experiment.simulation_experiment_id}_copy`,
  }
  const board = input.circuitJson.filter(
    ({ type }) => type !== "simulation_experiment",
  )
  for (const selected of [[], [experiment, duplicate]]) {
    const solver = new ChannelNetlistSolver({
      ...input,
      circuitJson: [...board, ...selected],
    })
    assert.throws(() => solver.solve(), {
      code: "simulation_experiment",
      message: `simulation_experiment: Channel netlist requires exactly one experiment, got ${selected.length}`,
    })
    assert.throws(() => solver.getOutput(), /netlist is incomplete/)
  }
})

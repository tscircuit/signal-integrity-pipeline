import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"

test("uses the lowered timing while compiling one buffer per step", async () => {
  const input = await renderTwoTraceNetlistInput()
  assert.ok(!Object.hasOwn(input, "options"))
  const experiment = input.circuitJson.find(
    (record) => record.type === "simulation_experiment",
  )
  assert.ok(experiment?.time_per_step)
  const solver = new ChannelNetlistSolver(input)
  for (const modelCount of [1, 2, 3]) {
    solver.step()
    assert.equal(solver.stats.models, modelCount)
    assert.equal(solver.solved, false)
    assert.throws(() => solver.getOutput(), /netlist is incomplete/)
  }
  solver.step()
  assert.equal(solver.solved, true)
  assert.equal(solver.iterations, 4)
  assert.equal(solver.MAX_ITERATIONS, 4)
  const output = solver.getOutput()
  assert.equal(output.value.plan.durationSeconds, 40e-9)
  assert.equal(
    output.value.plan.maxStepSeconds,
    experiment.time_per_step / 1000,
  )
  assert.equal(output.value.models.length, 4)
  assert.equal(output.artifacts.length, 7)
  const assembly = output.artifacts.findLast(({ owner }) => owner === "buffers")
  assert.ok(assembly)
  assert.deepEqual(
    JSON.parse(assembly.body).map(
      ({ simulationIbisModelId }: { simulationIbisModelId: string }) =>
        simulationIbisModelId,
    ),
    output.value.plan.models.map(({ pipelineId }) => pipelineId),
  )
  solver.step()
  assert.equal(solver.getOutput(), output)
})

import { spyOn, test } from "bun:test"
import assert from "node:assert/strict"
import * as buffers from "../../../src/buffers"
import { sha256 } from "../../../src/kernel"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"

test("uses the lowered timing while compiling one buffer per step", async () => {
  const input = await renderTwoTraceNetlistInput()
  assert(!/copperScope|traceContacts/.test(Object.keys(input.modeling).join()))
  const [experimentId, control] = Object.entries(input.controls)[0]
  const [driver, ...otherStimuli] = control.stimuli
  const driverOffsetMs = 5e-6
  const timing = {
    start_time_ms: 7e-6,
    end_time_ms: 53e-6,
    time_per_step: 75e-9,
  }
  const solver = new ChannelNetlistSolver({
    ...input,
    controls: {
      [experimentId]: {
        ...control,
        stimuli: [
          { ...driver, start_time_ms: driverOffsetMs },
          ...otherStimuli,
        ],
      },
    },
    circuitJson: input.circuitJson.map((record) => {
      if (record.type !== "simulation_experiment") return record
      return { ...record, ...timing }
    }),
  })
  using compile = spyOn(buffers, "compileBuffers")
  using assemble = spyOn(buffers, "ibisAssembly")
  for (const modelCount of [1, 2, 3]) {
    solver.step()
    assert.equal(compile.mock.calls.length, modelCount)
    assert.equal(assemble.mock.calls.length, 0)
    assert.equal(solver.stats.models, modelCount)
    assert.equal(solver.solved, false)
    assert.throws(() => solver.getOutput(), /netlist is incomplete/)
  }
  solver.step()
  assert.deepEqual(
    compile.mock.calls.map(([{ plans }]) =>
      plans.map(({ models }) => models.length),
    ),
    [[1], [1], [1], [1]],
  )
  assert.equal(assemble.mock.calls.length, 1)
  assert.equal(solver.solved, true)
  assert.equal(solver.iterations, 4)
  const output = solver.getOutput()
  assert.equal(output.value.models.length, 4)
  const [model] = output.value.models
  const [compiled] = assemble.mock.calls[0][0].models
  assert.deepEqual(Object.keys(model).sort(), [
    "metadata",
    "name",
    "source",
    "sourceEvidence",
    "spicePinMapping",
    "warnings",
  ])
  assert.equal(model.name, "LVC1G04_DCK")
  assert.equal(model.sourceEvidence.sourceSha256, sha256(routedVisualIbis))
  assert.deepEqual(model.metadata, compiled.metadata)
  assert.deepEqual(model.warnings, compiled.warnings)
  assert.deepEqual(model.sourceEvidence, compiled.sourceEvidence)
  assert.equal(output.value.plan.startTimeSeconds, timing.start_time_ms / 1000)
  assert.equal(output.value.plan.durationSeconds, timing.end_time_ms / 1000)
  assert.equal(output.value.plan.maxStepSeconds, timing.time_per_step / 1000)
  const modelIds = output.value.plan.models.map(({ pipelineId }) => pipelineId)
  const prefix = input.artifactPrefix
  const assemblyPath = `${prefix}/native-ibis-assembly.json`
  assert.deepEqual(
    output.artifacts.map(({ owner, path }) => `${owner}:${path}`).toSorted(),
    [
      ...modelIds.map((id) => `buffers:${prefix}/inputs/ibis/${id}.ibs`),
      `buffers:${prefix}/vendor-sources.json`,
      `buffers:${assemblyPath}`,
      `simulation:${prefix}/electrical-node-map.json`,
    ].toSorted(),
  )
  const assembly = output.artifacts.find(({ path }) => path === assemblyPath)
  assert.ok(assembly)
  const entries: buffers.AssemblyEntry[] = JSON.parse(assembly.body)
  assert.deepEqual(
    entries.map(({ simulationIbisModelId, run }) => [
      simulationIbisModelId,
      run.duration,
    ]),
    modelIds.map((id) => [id, timing.end_time_ms]),
  )
  const [driverStimulus] = Object.values(entries[0].run.stimuli)
  assert.equal(driverStimulus.pattern.bits, "10")
  assert.equal(driverStimulus.inverted, false)
  assert.equal(driverStimulus.startTime, driverOffsetMs)
  assert.equal(driverStimulus.initialState, 1)
  solver.step()
  assert.equal(compile.mock.calls.length, 4)
  assert.equal(assemble.mock.calls.length, 1)
  assert.equal(solver.getOutput(), output)
})

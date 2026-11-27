import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("captures inputs once and replays them with an unused invalid IBIS asset", async () => {
  const original = await renderTwoTraceNetlistInput()
  const experiment = original.circuitJson.find(
    (record) => record.type === "simulation_experiment",
  )
  assert.ok(experiment?.end_time_ms)
  let endTimeMs = experiment.end_time_ms
  const circuitJson = Object.freeze(
    original.circuitJson.map((record) => {
      if (record !== experiment) return record
      return Object.freeze({
        ...experiment,
        /** Read the caller's current end time even after the record is frozen. */
        get end_time_ms(): number {
          return endTimeMs
        },
      })
    }),
  )
  const receiverPaths = [...original.receiverPaths]
  const traceContacts = [...original.traceContacts]
  const supplies = original.modeling.supplies?.slice() ?? []
  const [experimentId, control] = Object.entries(original.controls)[0]
  const stimuli = [...control.stimuli]
  const bytes = new TextEncoder().encode(routedVisualIbis)
  const ibisSources = {
    [inverterModelPath]: bytes,
    "unused.ibs": 42 as unknown as Uint8Array,
  }
  const input = {
    ...original,
    circuitJson,
    receiverPaths,
    traceContacts,
    modeling: { ...original.modeling, supplies },
    controls: { ...original.controls, [experimentId]: { ...control, stimuli } },
    ibisSources,
    extra: true,
  }
  const solver = new ChannelNetlistSolver(input)
  const [captured] = solver.getConstructorParams()
  assert.ok(!Object.hasOwn(captured, "extra"))
  const exposedBytes = captured.ibisSources[inverterModelPath]
  assert.ok(exposedBytes instanceof Uint8Array)
  endTimeMs = 0
  receiverPaths.length = 0
  traceContacts.length = 0
  supplies.length = 0
  stimuli.length = 0
  ibisSources[inverterModelPath] = new Uint8Array()
  bytes.fill(0)
  exposedBytes.fill(0)
  solver.solve()

  const output = solver.getOutput()
  const { value, artifacts } = output
  const baseline = new ChannelNetlistSolver(original)
  baseline.solve()
  assert.deepEqual(output, baseline.getOutput())
  const frozen = [
    output,
    value,
    value.circuitJson[0],
    value.receiverPaths[0],
    value.receiverPaths,
    value.nodeMap,
    value.models[0].spicePinMapping,
    artifacts,
    ...artifacts,
  ]
  assert.ok(frozen.every(Object.isFrozen))

  const replay = new ChannelNetlistSolver(captured)
  replay.solve()
  assert.deepEqual(replay.getOutput(), output)
})

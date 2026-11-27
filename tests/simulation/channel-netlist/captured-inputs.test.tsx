import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { sha256 } from "../../../src/kernel"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("captures inputs once and replays them with an unused invalid IBIS asset", async () => {
  const original = await renderTwoTraceNetlistInput()
  const circuitJson = Object.freeze(cloneCircuitJson(original.circuitJson))
  const experiment = circuitJson.find(
    (record) => record.type === "simulation_experiment",
  )
  assert.ok(experiment)
  const receiverPaths = [...original.receiverPaths]
  const bytes = new TextEncoder().encode(routedVisualIbis)
  const solver = new ChannelNetlistSolver({
    ...original,
    circuitJson,
    receiverPaths,
    ibisSources: {
      [inverterModelPath]: bytes,
      "unused.ibs": 42 as unknown as Uint8Array,
    },
  })
  const [captured] = solver.getConstructorParams()
  const exposedBytes = captured.ibisSources[inverterModelPath]
  assert.ok(exposedBytes instanceof Uint8Array)
  experiment.end_time_ms = 0
  receiverPaths.length = 0
  bytes.fill(0)
  exposedBytes.fill(0)
  solver.solve()

  const output = solver.getOutput()
  const { value, artifacts } = output
  assert.deepEqual(value.circuitJson, original.circuitJson)
  assert.deepEqual(value.receiverPaths, original.receiverPaths)
  assert.equal(
    value.models[0].sourceEvidence.sourceSha256,
    sha256(routedVisualIbis),
  )
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
  const [replayInput] = replay.getConstructorParams()
  assert.equal(replayInput.circuitJson, captured.circuitJson)
  assert.equal(replayInput.ibisSources, captured.ibisSources)
  assert.deepEqual(replay.getOutput(), output)
})

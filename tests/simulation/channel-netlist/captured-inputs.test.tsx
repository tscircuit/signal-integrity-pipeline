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
  const circuitJson = cloneCircuitJson(original.circuitJson)
  const receiverPaths = [...original.receiverPaths]
  const copperScope = {
    ...original.copperScope,
    extractedPcbTraceIds: [...original.copperScope.extractedPcbTraceIds],
  }
  const bytes = new TextEncoder().encode(routedVisualIbis)
  const solver = new ChannelNetlistSolver({
    ...original,
    circuitJson,
    receiverPaths,
    copperScope,
    ibisSources: {
      [inverterModelPath]: bytes,
      "unused.ibs": 42 as unknown as Uint8Array,
    },
  })
  circuitJson.length = 0
  bytes.fill(0)
  solver.step()
  receiverPaths.length = 0
  copperScope.extractedPcbTraceIds.length = 0
  solver.solve()

  const output = solver.getOutput()
  const { value, artifacts } = output
  assert.deepEqual(value.circuitJson, original.circuitJson)
  assert.deepEqual(value.receiverPaths, original.receiverPaths)
  assert.deepEqual(value.copperScope, original.copperScope)
  assert.equal(
    value.models[0].sourceEvidence.sourceSha256,
    sha256(routedVisualIbis),
  )
  const frozen = [
    output,
    value,
    value.circuitJson[0],
    value.receiverPaths[0],
    value.copperScope.extractedPcbTraceIds,
    value.nodeMap,
    value.models[0].spicePinMapping,
    artifacts,
    ...artifacts,
  ]
  assert.ok(frozen.every(Object.isFrozen))

  const [captured] = solver.getConstructorParams()
  const replay = new ChannelNetlistSolver(captured)
  replay.solve()
  assert.equal(
    replay.getConstructorParams()[0].ibisSources,
    captured.ibisSources,
  )
  assert.deepEqual(replay.getOutput(), output)
})

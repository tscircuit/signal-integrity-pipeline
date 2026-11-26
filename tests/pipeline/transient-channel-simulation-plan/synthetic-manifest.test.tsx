import { test } from "bun:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cju } from "@tscircuit/circuit-json-util"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { listChannelSimulations } from "../../../src/pipeline/signals"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("synthetic planning emits the receiver paths and hashes the supplied bytes", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = Buffer.from(routedVisualIbis)
  const input = {
    circuitJson,
    ibisSources: { [inverterModelPath]: bytes },
    nearbyGapMm: 1,
  }
  const solver = new TransientChannelSimulationPlanSolver(input)
  solver.step()
  assert.equal(solver.solved, true)
  const {
    value: [plan],
    artifacts,
  } = solver.getOutput()
  const [channelSimulation] = listChannelSimulations(circuitJson)
  const simulationPcbTransientChannelSimulationId =
    channelSimulation.simulation_pcb_transient_channel_simulation_id
  assert.equal(
    plan.simulationPcbTransientChannelSimulationId,
    simulationPcbTransientChannelSimulationId,
  )
  assert.equal(
    plan.sections.artifactPrefix,
    `channelSimulations/${simulationPcbTransientChannelSimulationId}`,
  )
  const db = cju(circuitJson)
  const driverReceiverChannels =
    db.simulation_pcb_driver_receiver_channel.list()
  const traces = db.source_trace.list()
  const expectedReceiverPaths = driverReceiverChannels.map((signal) => {
    assert.ok(
      "source_port_id" in signal.driver &&
        "source_port_id" in signal.receivers[0],
    )
    const from = signal.driver.source_port_id
    const to = signal.receivers[0].source_port_id
    const trace = traces.find((record) => {
      const ports = record.connected_source_port_ids
      return ports.length === 2 && ports.includes(from) && ports.includes(to)
    })
    assert.ok(trace, signal.name)
    return {
      channelName: signal.name,
      fromSourcePortId: from,
      toSourcePortId: to,
      sourceTraceId: trace.source_trace_id,
    }
  })
  assert.deepEqual(plan.bindings.receiverPaths, expectedReceiverPaths)
  assert.equal(plan.sections.copperScope.channelPcbTraceIds.length, 2)
  assert.deepEqual(
    artifacts.map((artifact) => artifact.path),
    ["transient-channel-simulation-plan.json"],
  )
  assert.deepEqual(JSON.parse(artifacts[0].body), {
    channelSimulations: [
      { simulationPcbTransientChannelSimulationId, name: "TWO", warnings: [] },
    ],
    models: {
      [inverterModelPath]: createHash("sha256").update(bytes).digest("hex"),
    },
  })
  assert.throws(
    () =>
      new TransientChannelSimulationPlanSolver({
        ...input,
        nearbyGapMm: 0,
      }).solve(),
    /Copper search gap must be finite and positive/,
  )
})

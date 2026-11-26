import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("preserves existing copper when a receiver path is incomplete", async () => {
  const renderedCircuitJson = await renderSignals({
    tree: <ChannelFixture route="driver-only" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const [channelSimulation] = cju([
    ...renderedCircuitJson,
  ]).simulation_pcb_transient_channel_simulation.list()
  assert.ok(channelSimulation)
  // Core rejects the incomplete route before emitting its declaration in strict mode.
  const circuitJson = renderedCircuitJson.map((record) => {
    if (record === channelSimulation)
      return { ...channelSimulation, allow_unrouted_traces: false }
    return record
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), { code: "channel_net" })
  const drawing = solver.visualize()
  assert.ok(
    drawing.texts?.some(
      ({ text }) => text === "DATA has an incomplete route between TX and RX.",
    ),
  )
  assert.ok(
    drawing.texts?.some(
      ({ text }) => text === "DATA: TX pin Y → RX pin A (incomplete route)",
    ),
  )
  assert.ok(drawing.lines?.some(({ strokeColor }) => strokeColor === "#39789a"))
  assert.ok(drawing.lines?.every(({ layer }) => layer !== "failure"))
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "partial-route-visual",
    caption:
      "Copper runs from TX to RS. The receiver path remains incomplete beyond RS.",
  })
})

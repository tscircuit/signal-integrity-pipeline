import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("draws a receiver pin in the color of the trace reaching it", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg idealMiddleLeg />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  const pin = drawing.texts?.find(({ text }) => text === "RX pin A")
  assert.equal(pin?.color, "#b45309")
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("draws the series passive between its two distinct routed traces", async () => {
  const circuitJson = await renderCoreSignals(<ChannelFixture route="series" />)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  assert.ok(
    drawing.polygons?.some(
      (shape) => shape.layer === "topology" && shape.label === "Series passive",
    ),
  )
  assert.ok(
    drawing.texts?.some(
      (text) => text.text === "DATA: RS pin 1 → RS pin 2 (series resistor RS)",
    ),
  )
  assert.ok(
    drawing.texts?.some((text) => text.text.includes("TX pin Y → RS pin 1")),
  )
  assert.ok(
    drawing.texts?.some((text) => text.text.includes("RS pin 2 → RX pin A")),
  )
  assert.equal(
    drawing.texts?.find(({ text }) => text === "RX pin A")?.color,
    "#b45309",
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "series-passive-visual",
    caption:
      "Two traces connect TX to RX through series resistor RS. This test checks that the plan splits the copper at RS and follows the signal across both traces.",
  })
})

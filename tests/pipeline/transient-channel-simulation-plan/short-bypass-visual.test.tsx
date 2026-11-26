import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("highlights an ideal connection that bypasses routed traces", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="series" short="channel" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  assert.equal(drawing.title, "SERIES: can't simulate")
  const diagnosticRows = new Set(
    drawing.rects
      ?.filter(
        (rect) =>
          rect.layer === "header" && rect.label?.startsWith("channel_short:"),
      )
      .map(({ center }) => center.y),
  )
  const explanation = drawing.texts
    ?.filter((text) => text.layer === "header" && diagnosticRows.has(text.y))
    .sort((a, b) => b.y - a.y)
  assert.equal(explanation?.length, 1)
  assert.equal(
    explanation.map(({ text }) => text).join(" "),
    "DATA has a bypass from TX to RX, skipping RS and both traces.",
  )
  const scaleText = drawing.texts?.find(
    (text) => text.layer === "header" && text.text === "2 mm",
  )
  assert.ok(scaleText)
  assert.ok(explanation.every((text) => text.fontSize === scaleText.fontSize))
  assert.ok(
    drawing.lines?.some(
      (line) => line.layer === "failure" && line.label === "Bypass",
    ),
  )
  assert.ok(
    drawing.polygons?.some(
      (shape) => shape.layer === "failure" && shape.label?.includes("TX.Y"),
    ),
  )
  assert.ok(drawing.texts)
  const legend = drawing.texts.find(({ text }) =>
    text.includes("-×- bypass"),
  )?.text
  assert.ok(legend)
  assert.ok(legend.includes("-×- bypass"))
  assert.ok(legend.includes("× bypassed trace"))
  assert.ok(!legend.includes("-- ideal connection"))
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "short-bypass-visual",
    caption:
      "Two traces connect TX to RX through resistor RS, alongside an ideal connection between them. This test checks that the plan stops when a bypass skips RS.",
  })
})

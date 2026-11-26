import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("draws the whole board with the open differential leg diagnostic in red", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential openPositive allowUnroutedTraces>
        <resistor
          name="RDRV"
          resistance="120"
          footprint="0402"
          pcbX={-7}
          connections={{ pin1: ".TX > .A", pin2: ".TX > .B" }}
        />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "channel_net",
    message: /BUS: no source path/,
  })
  const drawing = solver.visualize()
  const header = drawing.texts?.filter((text) => text.layer === "header")
  assert.ok(drawing.lines?.length)
  assert.ok(drawing.texts?.length)
  const fault = drawing.texts.find((text) =>
    text.text.includes("has an incomplete route"),
  )
  assert.equal(fault?.color, "#b91c1c")
  assert.ok(header?.every((text) => text.anchorSide === "center" && text.y > 6))
  assert.ok(
    drawing.lines.some(
      (line) =>
        line.layer === "failure" &&
        line.label?.includes("No routed source path"),
    ),
  )
  assert.equal(fault?.text, "BUS+ has an incomplete route between TX and RX.")
  assert.ok(
    drawing.rects?.some(
      (rect) =>
        rect.layer === "header" && rect.label?.startsWith("channel_net:"),
    ),
  )
  assert.ok(drawing.texts.every((text) => !text.text.includes("source_port_")))
  const pins = drawing.texts.filter((text) => text.layer === "pin labels")
  assert.deepEqual(
    pins
      .filter(({ color }) => color === "#b91c1c")
      .map(({ text }) => text)
      .sort(),
    ["RX pin A", "TX pin A"],
  )
  assert.deepEqual(
    pins
      .filter(({ color }) => color === "#39789a")
      .map(({ text }) => text)
      .sort(),
    ["RX pin B", "TX pin B"],
  )
  const visibleText = drawing.texts.map(({ text }) => text)
  assert.ok(visibleText.includes("VCC copper (top)"))
  assert.ok(visibleText.includes("GND copper (bottom)"))
  assert.ok(
    visibleText.includes(
      "▶ driver · ◉ receiver · ◎ via · -×- incomplete route",
    ),
  )
  assert.ok(
    visibleText.includes("BUS+: TX pin A → RX pin A (incomplete route)"),
  )
  assert.ok(visibleText.includes("BUS−: TX pin B → RX pin B (top, 10 mm)"))
  assert.ok(!visibleText.includes("RTERM"))
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "plan-failure-visual",
    caption:
      "TX drives an RS-485 signal to RX over BUS+ and BUS−, with only BUS− routed. This test checks that the plan stops when a signal line has no trace.",
  })
})

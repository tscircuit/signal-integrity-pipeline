import { test } from "bun:test"
import assert from "node:assert/strict"
import { parseIbis } from "@tscircuit/ibis-to-spice"
import type { GraphicsObject } from "graphics-debug"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import {
  convert,
  points,
  source,
  switchingInput,
} from "../../fixtures/switching"

const SECONDS_PER_NANOSECOND = 1e-9
const PANEL_WIDTH = 8
const AXIS_COLOR = "#526177"
const PULLUP_COLOR = "#1a5ba9"
const PULLDOWN_COLOR = "#a14324"

/** Scale the measured fixture and scheduled coefficients to their panel axes. */
function panelX({
  timeSeconds,
  endSeconds,
}: {
  timeSeconds: number
  endSeconds: number
}): number {
  return (PANEL_WIDTH * timeSeconds) / endSeconds
}

test("plots the waveform cutoff and scheduled switching coefficients", async () => {
  const input = await switchingInput()
  const converted = convert({ next: input })
  const tail = converted.metadata.switchingTails?.find(
    ({ edge }) => edge === "rising",
  )
  assert.ok(tail)
  const waveforms = parseIbis(source)
    .getBuffer("driver")
    .waveforms.filter(({ kind }) => kind === "rising")
  const cutoffX = panelX({
    timeSeconds: tail.cutoffTimeSeconds,
    endSeconds: 4e-9,
  })
  const drawing: GraphicsObject = {
    lines: [
      {
        points: [
          { x: 0, y: 3 },
          { x: 0, y: 5.1 },
        ],
        strokeColor: AXIS_COLOR,
        strokeWidth: 0.012,
      },
      {
        points: [
          { x: 0, y: 3 },
          { x: PANEL_WIDTH, y: 3 },
        ],
        strokeColor: AXIS_COLOR,
        strokeWidth: 0.012,
      },
      {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 2.05 },
        ],
        strokeColor: AXIS_COLOR,
        strokeWidth: 0.012,
      },
      {
        points: [
          { x: 0, y: 0 },
          { x: PANEL_WIDTH, y: 0 },
        ],
        strokeColor: AXIS_COLOR,
        strokeWidth: 0.012,
      },
      {
        points: [
          { x: cutoffX, y: 3 },
          { x: cutoffX, y: 5.1 },
        ],
        strokeColor: AXIS_COLOR,
        strokeWidth: 0.012,
        strokeDash: "5 4",
      },
      ...waveforms.map((waveform, index) => ({
        points: waveform.data.map(([timeSeconds, voltageVolts]) => ({
          x: panelX({ timeSeconds, endSeconds: 4e-9 }),
          y: 3 + Number(voltageVolts) * 1.2,
        })),
        strokeColor: [PULLUP_COLOR, PULLDOWN_COLOR][index],
        strokeWidth: 0.03,
      })),
      ...(["KU", "KD"] as const).map((label, index) => ({
        points: points({ text: converted.source, label }).map(
          ([timeSeconds, coefficient]) => ({
            x: panelX({ timeSeconds, endSeconds: 5e-9 }),
            y: coefficient * 1.65,
          }),
        ),
        strokeColor: [PULLUP_COLOR, PULLDOWN_COLOR][index],
        strokeWidth: 0.03,
      })),
    ],
    rects: [
      {
        center: { x: 4 + cutoffX / 2, y: 3.9 },
        width: PANEL_WIDTH - cutoffX,
        height: 0.018,
        fill: "#dae8fa",
      },
      {
        center: { x: 4 + cutoffX / 2, y: 4.8 },
        width: PANEL_WIDTH - cutoffX,
        height: 0.018,
        fill: "#f8dfd6",
      },
    ],
    texts: [
      { x: 4, y: 5.65, text: "Measured rising waveform", fontSize: 0.22 },
      {
        x: 4,
        y: 5.32,
        text: "Shading marks ±1% of each fixture swing",
        fontSize: 0.15,
        color: AXIS_COLOR,
      },
      { x: -0.45, y: 4.8, text: "1.5 V", fontSize: 0.13 },
      { x: -0.45, y: 3, text: "0 V", fontSize: 0.13 },
      {
        x: cutoffX,
        y: 2.71,
        text: `${(tail.cutoffTimeSeconds / SECONDS_PER_NANOSECOND).toFixed(1)} ns cutoff`,
        fontSize: 0.15,
      },
      { x: 7.72, y: 2.71, text: "4 ns", fontSize: 0.13 },
      {
        x: 4,
        y: 2.31,
        text: "Scheduled switching coefficients",
        fontSize: 0.22,
      },
      { x: -0.45, y: 1.65, text: "1", fontSize: 0.13 },
      { x: -0.45, y: 0, text: "0", fontSize: 0.13 },
      { x: 0, y: -0.29, text: "0 ns", fontSize: 0.13 },
      { x: 2, y: -0.29, text: "1.25 ns", fontSize: 0.13 },
      { x: 7.72, y: -0.29, text: "5 ns", fontSize: 0.13 },
      { x: 6.7, y: 2.0, text: "Pullup", fontSize: 0.14, color: PULLUP_COLOR },
      {
        x: 7.6,
        y: 2.0,
        text: "Pulldown",
        fontSize: 0.14,
        color: PULLDOWN_COLOR,
      },
    ],
  }
  assertPlanDrawingSnapshot({
    drawing,
    module: "buffers",
    name: "switching-waveform",
    trimTrailingWhitespace: true,
  })
})

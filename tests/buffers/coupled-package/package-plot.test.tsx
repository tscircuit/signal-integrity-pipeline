import { test } from "bun:test"
import assert from "node:assert/strict"
import type { GraphicsObject } from "graphics-debug"
import { convertIbisComponentWithPackage } from "../../../src/buffers/package-conversion"
import { source } from "../../fixtures/coupled-package"
import { packageInput, renderPackageModel } from "../../fixtures/package-input"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"

const PICOFARADS_PER_FARAD = 1e12
const SIGNAL_COLOR = "#1a5ba9"
const CAPACITANCE_COLOR = "#a14324"

test("shows the coupled package paths and board and die shunts", async () => {
  const input = packageInput(await renderPackageModel())
  const converted = convertIbisComponentWithPackage({
    bytes: new TextEncoder().encode(source),
    input,
  })
  const matrices = converted.metadata.packageData.matrices
  assert.ok(matrices)
  assert.match(converted.source, /^CPKG0_1a PAD0 PAD1 /m)
  assert.match(converted.source, /^CPKG0_1b PKGD0 PKGD1 /m)
  const mutualPicofarads = (-matrices.C[0][1] * PICOFARADS_PER_FARAD) / 2
  const drawing: GraphicsObject = {
    lines: [
      ...[3.1, 1.45].map((y) => ({
        points: [
          { x: 0, y },
          { x: 9, y },
        ],
        strokeColor: SIGNAL_COLOR,
        strokeWidth: 0.03,
      })),
      ...[1.45, 7.55].flatMap((x) => [
        {
          points: [
            { x, y: 3.1 },
            { x, y: 2.42 },
          ],
          strokeColor: CAPACITANCE_COLOR,
          strokeWidth: 0.03,
        },
        {
          points: [
            { x: x - 0.18, y: 2.42 },
            { x: x + 0.18, y: 2.42 },
          ],
          strokeColor: CAPACITANCE_COLOR,
          strokeWidth: 0.03,
        },
        {
          points: [
            { x: x - 0.18, y: 2.19 },
            { x: x + 0.18, y: 2.19 },
          ],
          strokeColor: CAPACITANCE_COLOR,
          strokeWidth: 0.03,
        },
        {
          points: [
            { x, y: 2.19 },
            { x, y: 1.45 },
          ],
          strokeColor: CAPACITANCE_COLOR,
          strokeWidth: 0.03,
        },
      ]),
      {
        points: [
          { x: 4.5, y: 1.16 },
          { x: 4.5, y: 3.4 },
        ],
        strokeColor: "#b6c8e1",
        strokeWidth: 0.02,
        strokeDash: "5 5",
      },
    ],
    rects: [3.1, 1.45].map((y) => ({
      center: { x: 4.5, y },
      width: 3.08,
      height: 0.5,
      fill: "#eef4fb",
      stroke: SIGNAL_COLOR,
    })),
    texts: [
      { x: 4.5, y: 4.75, text: "Coupled IBIS package", fontSize: 0.25 },
      {
        x: 0.4,
        y: 4.05,
        text: "Board pins",
        color: SIGNAL_COLOR,
        fontSize: 0.18,
      },
      {
        x: 8.6,
        y: 4.05,
        text: "Die pads",
        color: SIGNAL_COLOR,
        fontSize: 0.18,
      },
      ...matrices.activePins.slice(0, 2).flatMap((pin, index) => {
        const y = [3.1, 1.45][index]
        return [
          { x: 0, y: y + 0.25, text: pin, fontSize: 0.15 },
          { x: 9, y: y + 0.25, text: pin, fontSize: 0.15 },
          {
            x: 4.5,
            y,
            text: `${matrices.R[index][index]} Ω · ${(matrices.L[index][index] * 1e9).toFixed(0)} nH`,
            fontSize: 0.17,
          },
        ]
      }),
      { x: 4.5, y: 2.38, text: "Mutual R and L", fontSize: 0.16 },
      {
        x: 2.1,
        y: 2.3,
        text: `${mutualPicofarads} pF`,
        fontSize: 0.15,
        color: CAPACITANCE_COLOR,
      },
      {
        x: 8.22,
        y: 2.3,
        text: `${mutualPicofarads} pF`,
        fontSize: 0.15,
        color: CAPACITANCE_COLOR,
      },
      {
        x: 4.5,
        y: 0.65,
        text: "Half of the mutual capacitance appears at each end.",
        fontSize: 0.17,
      },
    ],
  }
  assertPlanDrawingSnapshot({
    drawing,
    module: "buffers",
    name: "coupled-package",
    trimTrailingWhitespace: true,
  })
})

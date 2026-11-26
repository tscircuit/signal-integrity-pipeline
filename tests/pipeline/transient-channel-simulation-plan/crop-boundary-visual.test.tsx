import { test } from "bun:test"
import assert from "node:assert/strict"
import { Box } from "@flatten-js/core"
import { cju } from "@tscircuit/circuit-json-util"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { clipPlanLines } from "../../../src/board/plan-view"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { renderSignals } from "../../fixtures/signal-render"

test("keeps copper from a crop boundary to an interior trace point", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  const [trace] = cju([...circuitJson]).pcb_trace.list()
  assert.ok(trace)
  const points = trace.route.flatMap((point) => {
    if (point.route_type === "through_pad") return []
    return [{ x: point.x, y: point.y }]
  })
  const start = points[0]
  const end = points.find(({ x, y }) => x !== start.x || y !== start.y)
  assert.ok(end)
  const minX = Math.min(start.x, end.x)
  const maxX = Math.max(start.x, end.x)
  const minY = Math.min(start.y, end.y)
  const maxY = Math.max(start.y, end.y)
  let crop = new Box(minX - 1, start.y, maxX + 1, maxY + 1)
  if (start.y > end.y) crop = new Box(minX - 1, minY - 1, maxX + 1, start.y)
  if (start.x < end.x) crop = new Box(start.x, minY - 1, maxX + 1, maxY + 1)
  if (start.x > end.x) crop = new Box(minX - 1, minY - 1, start.x, maxY + 1)
  const lines = clipPlanLines({ lines: [{ points: [start, end] }], crop })
  assert.deepEqual(
    lines.map((line) => line.points.map(({ x, y }) => ({ x, y }))),
    [[start, end]],
  )
  assertPlanDrawingSnapshot({
    drawing: {
      lines: [
        {
          points: [
            { x: crop.xmin, y: crop.ymin },
            { x: crop.xmax, y: crop.ymin },
            { x: crop.xmax, y: crop.ymax },
            { x: crop.xmin, y: crop.ymax },
            { x: crop.xmin, y: crop.ymin },
          ],
          strokeColor: "#cbd5e1",
          strokeDash: "4,4",
        },
        ...lines,
      ],
      coordinateSystem: "cartesian",
    },
    name: "crop-boundary-visual",
    module: "pipeline/transient-channel-simulation-plan",
  })
})

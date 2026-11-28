import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import type { GraphicsObject } from "graphics-debug"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import {
  cloneCircuitJson,
  routeBoardDrawing,
  routeDisplayItems,
  routeFrame,
  routeMarks,
  routeStrip,
  routeStroke,
  routeView,
} from "../../src/board"
import { renderRoutedCopper } from "../fixtures/routed-copper"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../fixtures/routed-visual"
import { renderCoreSignals } from "../support/core-render"

test("one camera frames connected copper, its endpoint parts and a pane", async () => {
  const { root } = await routedVisualFixture()
  const { circuitJson: sectionsCircuit, copperScope: scope } = root.stageOutput(
    "CopperGeometryExtractionSolver",
  ).value[0]
  const circuitJson = cloneCircuitJson(sectionsCircuit)
  const view = routeView({ circuit: circuitJson, scope })
  const nets = new Set(view.sources.values())
  assert.equal(nets.size, 2)
  assert.notEqual([...nets][0].hue, [...nets][1].hue)
  assert.equal(
    routeView({ circuit: circuitJson, scope }),
    view,
    "cached per problem, so every stage shares it",
  )
  const { focus, pane, camera } = view
  assert.ok(
    pane.minX >= focus.maxX || pane.maxY <= focus.minY,
    "the pane sits beside the focus, never on it",
  )
  assert.deepEqual(camera, {
    minX: Math.min(focus.minX, pane.minX),
    maxX: Math.max(focus.maxX, pane.maxX),
    minY: Math.min(focus.minY, pane.minY),
    maxY: Math.max(focus.maxY, pane.maxY),
  })
  const drawing = routeBoardDrawing({ circuit: circuitJson, scope })
  assert.equal(drawing.rects![0].label, "camera")
  assert.equal(drawing.texts!.length, 0, "no captions or legends")
  assert.ok(
    drawing.lines!.every((line) => line.strokeWidth === 0.1 && line.label),
    "real copper width, labelled with its net for hover",
  )
  const copper = await renderRoutedCopper()
  assert.equal(
    new Set(
      routeView({
        circuit: copper.circuitJson,
        scope: copper.copperScope,
      }).sources.values(),
    ).size,
    1,
    "a neighbour is context, not a net",
  )
  assert.deepEqual(
    routeBoardDrawing({
      circuit: circuitJson,
      scope: undefined,
    }).lines,
    [],
    "without a scope nothing is overlaid, so the whole board shows",
  )
})

test("a differential channel colours its two nets as two shades of one hue and carries its bit period", async () => {
  const { root } = await routedVisualFixture()
  const { copperScope: scope } = root.stageOutput(
    "CopperGeometryExtractionSolver",
  ).value[0]
  const board = TwoTraceBoard()
  const children = React.Children.toArray(board.props.children).filter(
    (child) =>
      !React.isValidElement(child) ||
      child.type !== simulation.pcbtransientchannelsimulation,
  )
  const circuit = await renderCoreSignals(
    React.cloneElement(
      board,
      {},
      ...children,
      <simulation.pcbtransientchannelsimulation
        name="PAIR_TEST"
        bitRate="100Mbps"
      >
        <simulation.pcbdriverreceiverchannel
          name="PAIR"
          driverRef={{ p: ".TX0 > .Y", n: ".TX1 > .Y" }}
          receiverRef={{ p: ".RX0 > .A", n: ".RX1 > .A" }}
          pattern="01"
        />
      </simulation.pcbtransientchannelsimulation>,
    ),
  )
  const view = routeView({ circuit, scope })
  const [p, n] = [...new Set(view.sources.values())]
  assert.equal(p.hue, n.hue)
  assert.notEqual(p.lightness, n.lightness)
  assert.deepEqual(
    [p.label, n.label, p.unitIntervalSeconds, p.differential],
    ["PAIR P", "PAIR N", 1e-8, true],
  )
})

test("the pane goes on the side that brings the camera nearest 1.6:1", () => {
  const tall = routeFrame({
    minX: 0,
    maxX: 10,
    minY: 0,
    maxY: 30,
  })
  assert.ok(tall.pane.minX > tall.focus.maxX)
  const wide = routeFrame({
    minX: 0,
    maxX: 30,
    minY: 0,
    maxY: 2,
  })
  assert.ok(wide.pane.maxY < wide.focus.minY)
  for (const frame of [tall, wide]) {
    const aspect =
      (frame.camera.maxX - frame.camera.minX) /
      (frame.camera.maxY - frame.camera.minY)
    assert.ok(aspect > 1.2 && aspect < 2.2, `aspect ${aspect}`)
  }
})

test("the layer is in the stroke: top solid, inner hollow, bottom dimmed", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]
  assert.equal(
    routeStroke({
      points,
      color: "red",
      width: 0.2,
      layer: "top",
    }).length,
    1,
  )
  const [inner, core] = routeStroke({
    points,
    color: "red",
    width: 0.2,
    layer: "inner2",
  })
  assert.ok(core.strokeWidth! < inner.strokeWidth!)
  const [, shade] = routeStroke({
    points,
    color: "red",
    width: 0.2,
    layer: "bottom",
  })
  assert.equal(shade.strokeWidth, 0.2)
})

test("pin marks never grow past half their closest spacing, and sit on a dark halo", () => {
  const drawing: GraphicsObject = { polygons: [] }
  drawing.polygons!.push(
    ...routeMarks({
      marks: [
        {
          point: { x: 0, y: 0 },
          color: "red",
          driver: true,
        },
        {
          point: { x: 0.8, y: 0 },
          color: "red",
          driver: false,
        },
      ],
      unit: 10,
    }),
  )
  assert.equal(drawing.polygons!.length, 4)
  const [first, second] = [
    drawing.polygons!.slice(0, 2),
    drawing.polygons!.slice(2),
  ].map((marks) =>
    marks.flatMap((polygon) => polygon.points.map((point) => point.x)),
  )
  assert.ok(Math.max(...first) < Math.min(...second), "halos never touch")
})

test("the strip unrolls nets to scale, centred in the pane, with one length label", async () => {
  const { root } = await routedVisualFixture()
  const { circuitJson: sectionsCircuit, copperScope: scope } = root.stageOutput(
    "CopperGeometryExtractionSolver",
  ).value[0]
  const circuitJson = cloneCircuitJson(sectionsCircuit)
  const view = routeView({ circuit: circuitJson, scope })
  const nets = [...new Set(view.sources.values())]
  const drawing = routeStrip({
    pane: view.pane,
    rows: [
      { net: nets[0], length: 8 },
      { net: nets[1], length: 4 },
    ],
  })
  const bars = drawing.lines!.filter((line) => line.label)
  const [long, short] = bars.map((line) => line.points[1].x - line.points[0].x)
  assert.ok(Math.abs(long / short - 2) < 1e-9)
  const middle = (view.pane.minY + view.pane.maxY) / 2
  assert.ok(
    Math.abs((bars[0].points[0].y + bars[1].points[0].y) / 2 - middle) < 1e-9,
  )
  assert.ok(drawing.texts!.some((text) => text.text === "8.00 mm"))
})

test("two-trace TSX board drawing SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  const sections = root.stageOutput("CopperGeometryExtractionSolver").value[0]
  const drawing = routeBoardDrawing({
    circuit: root.inputProblem.circuitJson,
    scope: sections.copperScope,
  })
  assertPlanDrawingSnapshot({
    drawing,
    module: "board",
    name: "route-visual-board",
  })
})

test("display sampling bounds object counts and preserves the first and last item", () => {
  const items = Array.from({ length: 10000 }, (_, i) => i)
  const shown = routeDisplayItems({ items })
  assert.equal(shown.length, 160)
  assert.equal(shown[0], 0)
  assert.equal(shown.at(-1), 9999)
  assert.equal(items.length, 10000, "solver inputs are never thinned")
})

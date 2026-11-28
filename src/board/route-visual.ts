import { cju } from "@tscircuit/circuit-json-util"
import type { GraphicsObject, Point, Viewbox } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { PcbTraceId, SourcePortId } from "./ids"
import { getBoardBounds as planBoardBox } from "./plan-view"
import {
  routeCircle as circle,
  routeNets as drawRouteNets,
  type RouteDrawing,
  routeCanvas,
  routePointSpacing,
} from "./route-visual-primitives"
import {
  type RouteNet,
  type RouteView,
  routeTones,
  routeView,
} from "./route-visual-view"
import type { CircuitJson } from "./schema"

export { getPointBounds } from "./plan-view"
export {
  routeCanvas,
  routeFailure,
  routeMarks,
  routeStroke,
  routeText,
} from "./route-visual-primitives"
export {
  type RouteFrame,
  type RouteNet,
  type RouteView,
  routeDisplayItems,
  routeFrame,
  routeHue,
  routeOutline,
  routeTones,
  routeView,
} from "./route-visual-view"

/** Add the overlay's primitives after the drawing's existing primitives. */
export function withRouteDrawing<Drawing extends GraphicsObject>({
  drawing,
  overlay,
}: {
  drawing: Drawing
  overlay: GraphicsObject
}): Drawing & Pick<RouteDrawing, "lines" | "polygons" | "rects" | "texts"> {
  return {
    ...drawing,
    lines: [...drawing.lines!, ...overlay.lines!],
    polygons: [...drawing.polygons!, ...overlay.polygons!],
    rects: [...drawing.rects!, ...overlay.rects!],
    texts: [...drawing.texts!, ...overlay.texts!],
  }
}

/** Override the selected copper or its tone for a particular stage. */
export function routeNets({
  circuit,
  view,
  traceIds = view.traces,
  color,
}: {
  circuit: CircuitJson
  view: RouteView
  traceIds?: Set<PcbTraceId>
  color?: RouteNetColor
}): RouteDrawing["lines"] {
  return drawRouteNets({
    db: cju([...circuit]),
    view: { traces: traceIds, sources: view.sources },
    color,
  })
}
type RouteNetColor = (net: RouteNet | undefined) => string

/** The one via glyph every stage uses: a white ring over a dark halo. */
export function routeVia({
  center,
  radius,
}: {
  center: Point
  radius: number
}): NonNullable<GraphicsObject["polygons"]> {
  const drawing = routeCanvas()
  drawing.polygons!.push({
    points: circle({ center, radius: radius * 1.2 }),
    stroke: routeTones.halo,
    strokeWidth: radius * 0.5,
  })
  drawing.polygons!.push({
    points: circle({ center, radius }),
    stroke: routeTones.via,
    strokeWidth: radius * 0.28,
  })
  return drawing.polygons!
}

/** The physical position of a source port. */
export function routePortPoint({
  circuit,
  sourcePortId,
}: {
  circuit: CircuitJson
  sourcePortId: SourcePortId
}): Point | undefined {
  const port = cju([...circuit]).pcb_port.getWhere({
    source_port_id: sourcePortId,
  })
  if (!port) return undefined
  return { x: port.x, y: port.y }
}

/** An opaque pane: a thick line at zIndex -1 fills it, because graphics-debug paints every line before other shapes. */
export function routePane({
  box,
  edge = routeTones.paneEdge,
}: {
  box: Viewbox
  edge?: string
}): GraphicsObject {
  const drawing = routeCanvas()
  const middle = (box.minY + box.maxY) / 2
  drawing.lines!.push({
    points: [
      { x: box.minX, y: middle },
      { x: box.maxX, y: middle },
    ],
    strokeColor: routeTones.pane,
    strokeWidth: box.maxY - box.minY,
    zIndex: -1,
  })
  drawing.polygons!.push({
    points: [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ],
    stroke: edge,
    strokeWidth: Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.003,
  })
  return drawing
}

/** Reuse the plan bounds for the debugger's board overlay. */
export function getBoardBounds(circuit: CircuitJson): Viewbox {
  return planBoardBox(cju([...circuit]))
}

/**
 * The problem's canvas with its selected copper in net colours; without a scope it is empty, so the whole
 * board shows.
 */
export function routeBoardDrawing({
  circuit,
  scope,
  color,
}: {
  circuit: CircuitJson
  scope: Snapshot<CopperScope> | undefined
  color?: RouteNetColor
}): RouteDrawing {
  if (!scope) return routeCanvas()
  const view = routeView({ circuit, scope })
  return { ...routeCanvas(view), lines: routeNets({ circuit, view, color }) }
}

/** Which way the selected copper leaves a pin, as a unit vector (east when no copper touches it). */
export function routePinDirection({
  circuit,
  view,
  pin,
}: {
  circuit: CircuitJson
  view: RouteView
  pin: Point
}): Point {
  for (const trace of cju([...circuit]).pcb_trace.list()) {
    if (!view.traces.has(trace.pcb_trace_id)) continue
    const wires = trace.route.filter((point) => point.route_type === "wire")
    for (const [i, point] of wires.entries()) {
      if (Math.hypot(point.x - pin.x, point.y - pin.y) > 1e-3) continue
      const next = wires[i + 1] ?? wires[i - 1]
      if (!next) continue
      const length = Math.hypot(next.x - point.x, next.y - point.y)
      if (length > 1e-9)
        return {
          x: (next.x - point.x) / length,
          y: (next.y - point.y) / length,
        }
    }
  }
  return { x: 1, y: 0 }
}

export type RouteBuffer = {
  point: Point
  direction: Point
  color: string
  driver: boolean
  label?: string
}

/**
 * IBIS buffer glyphs at their pins: a filled ▶ leaving each driver, a hollow ◀ arriving at each receiver, over
 * a dark halo.
 */
export function routeBuffers({
  buffers,
  unit,
}: {
  buffers: readonly RouteBuffer[]
  unit: number
}): NonNullable<GraphicsObject["polygons"]> {
  const drawing = routeCanvas()
  const size = Math.min(
    unit * 1.6,
    routePointSpacing(buffers.map((buffer) => buffer.point)) * 0.48,
  )
  for (const buffer of buffers) {
    let along = { x: -buffer.direction.x, y: -buffer.direction.y }
    let tip = buffer.point
    let fill: string = routeTones.halo
    let stroke = buffer.color
    if (buffer.driver) {
      along = buffer.direction
      tip = {
        x: buffer.point.x + along.x * size * 1.6,
        y: buffer.point.y + along.y * size * 1.6,
      }
      fill = buffer.color
      stroke = routeTones.halo
    }
    const across = { x: -along.y, y: along.x }
    const base = {
      x: tip.x - along.x * size * 1.6,
      y: tip.y - along.y * size * 1.6,
    }
    const points = [
      tip,
      {
        x: base.x + across.x * size * 0.8,
        y: base.y + across.y * size * 0.8,
      },
      {
        x: base.x - across.x * size * 0.8,
        y: base.y - across.y * size * 0.8,
      },
    ]
    drawing.polygons!.push({
      points,
      fill,
      stroke,
      strokeWidth: size * 0.25,
      label: buffer.label,
    })
  }
  return drawing.polygons!
}

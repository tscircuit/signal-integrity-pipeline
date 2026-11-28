import { cju } from "@tscircuit/circuit-json-util"
import type { Viewbox } from "graphics-debug"
import type { TraceWire } from "./copper-geometry-types"
import {
  type RouteBuffer,
  type RouteNet,
  type RouteView,
  routeBuffers,
  routePane,
  routeTones,
  withRouteDrawing,
} from "./route-visual"
import {
  type RouteDrawing,
  routeCanvas,
  routeText,
} from "./route-visual-primitives"
import type { CircuitJson } from "./schema"

/** One unrolled net with its colored sections, node ticks and coupling bands. */
export interface RouteStripRow {
  net: RouteNet
  length: number
  /** Coloured pieces along the unrolled net; `casing` marks the piece being worked on. */
  parts?: {
    from: number
    to: number
    color: string
    casing?: boolean
  }[]
  ticks?: number[]
  /** Coupling to neighbours along the net, drawn under the bar with height growing with k. */
  bands?: {
    from: number
    to: number
    k: number
  }[]
}

/** Convert position along a net to its x coordinate in the pane. */
function routeStripX({
  position,
  scale,
}: {
  position: number
  scale: {
    left: number
    right: number
    longest: number
  }
}): number {
  const { left, right, longest } = scale
  return left + (position / longest) * (right - left)
}

/**
 * Every net unrolled into a to-scale bar in the pane, with a quiet name and the longest length; buffer glyphs
 * at the ends when `buffers` is set.
 */
export function routeStrip({
  pane,
  rows,
  buffers,
}: {
  pane: Viewbox
  rows: readonly RouteStripRow[]
  buffers?: {
    driver: boolean
    receiver: boolean
  }
}): RouteDrawing {
  let drawing = routeCanvas()
  drawing = withRouteDrawing({
    drawing: drawing,
    overlay: routePane({ box: pane }),
  })
  if (!rows.length) return drawing
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const left = pane.minX + (pane.maxX - pane.minX) * 0.2
  const right = pane.maxX - unit * 4
  const pitch = Math.min(
    (pane.maxY - pane.minY - unit * 10) / rows.length,
    unit * 6,
  )
  const longest = Math.max(...rows.map((row) => row.length), 1e-9)
  const bar = Math.min(pitch * 0.4, unit * 1.6)
  const scale = { left, right, longest }
  const glyphs: RouteBuffer[] = []
  for (const [i, row] of rows.entries()) {
    const y = (pane.minY + pane.maxY) / 2 + pitch * (rows.length / 2 - i - 0.5)
    for (const band of row.bands ?? [])
      drawing.lines!.push({
        points: [
          {
            x: routeStripX({
              position: band.from,
              scale,
            }),
            y: y - bar,
          },
          {
            x: routeStripX({
              position: band.to,
              scale,
            }),
            y: y - bar,
          },
        ],
        strokeColor: routeTones.coupling,
        strokeWidth: Math.min(
          pitch * 0.45,
          bar * 4 * Math.min(1, band.k / 0.25),
        ),
        zIndex: -0.5,
        label: `k ${band.k.toFixed(2)}`,
      })
    for (const part of row.parts ?? [
      { from: 0, to: row.length, color: row.net.color },
    ]) {
      const points = [
        { x: routeStripX({ position: part.from, scale }), y },
        { x: routeStripX({ position: part.to, scale }), y },
      ]
      if (part.casing) {
        drawing.lines!.push({
          points,
          strokeColor: routeTones.via,
          strokeWidth: bar * 1.8,
        })
      }
      drawing.lines!.push({
        points: [{ ...points[0] }, { ...points[1] }],
        strokeColor: part.color,
        strokeWidth: bar,
        label: row.net.label,
      })
    }
    for (const tick of row.ticks ?? [])
      drawing.lines!.push({
        points: [
          { x: routeStripX({ position: tick, scale }), y: y - bar },
          { x: routeStripX({ position: tick, scale }), y: y + bar },
        ],
        strokeColor: routeTones.cell,
        strokeWidth: unit * 0.15,
      })
    if (rows.length <= 32)
      drawing.texts!.push(
        routeText({
          x: left - unit * 2,
          y,
          text: row.net.label,
          color: routeTones.quiet,
          size: Math.min(unit * 2.6, pitch * 0.8),
          anchor: "center_right",
        }),
      )
    if (buffers)
      glyphs.push(
        {
          point: { x: routeStripX({ position: 0, scale }) - unit, y },
          direction: { x: 1, y: 0 },
          color: row.net.color,
          driver: true,
          label: row.net.label,
        },
        {
          point: {
            x: routeStripX({ position: row.length, scale }) + unit * 0.5,
            y,
          },
          direction: { x: -1, y: 0 },
          color: row.net.color,
          driver: false,
          label: row.net.label,
        },
      )
  }
  if (glyphs.length)
    drawing.polygons!.push(...routeBuffers({ buffers: glyphs, unit }))
  let decimals = 1
  if (longest < 10) decimals = 2
  drawing.texts!.push(
    routeText({
      x: right,
      y: (pane.minY + pane.maxY) / 2 + pitch * (rows.length / 2) + unit * 2,
      text: `${longest.toFixed(decimals)} mm`,
      color: routeTones.quiet,
      size: unit * 2.6,
      anchor: "center_right",
    }),
  )
  return drawing
}

/** Each selected net's routed length from its copper, in net order. */
export function routeLengths({
  circuit,
  view,
}: {
  circuit: CircuitJson
  view: RouteView
}): RouteStripRow[] {
  const lengths = new Map<RouteNet, number>()
  for (const trace of cju([...circuit]).pcb_trace.list()) {
    if (!view.traces.has(trace.pcb_trace_id)) continue
    const net = view.sources.get(trace.source_trace_id ?? "")
    if (!net) continue
    const wires = trace.route.filter((point) => point.route_type === "wire")
    lengths.set(
      net,
      (lengths.get(net) ?? 0) +
        wires
          .slice(1)
          .reduce(
            (sum, point, i) =>
              sum + Math.hypot(point.x - wires[i].x, point.y - wires[i].y),
            0,
          ),
    )
  }
  return [...lengths].map(([net, length]) => ({ net, length }))
}

/** A net and the distance along it from the start of its unrolled copper. */
type UnrolledRoutePosition = {
  net: RouteNet
  distance: number
}

/** The length of each unrolled net and a lookup from a wire position to a net distance. */
type UnrolledRoutes = {
  lengths: Map<RouteNet, number>
  along: RoutePositionLookup
}

/** A wire's starting distance on its net. */
interface UnrolledWireOffset {
  net: RouteNet
  offset: number
  start: number
}

/** Resolve a wire position into a distance from the start of its net. */
type RoutePositionLookup = (location: {
  id: TraceWire["wireIndex"]
  position: number
}) => UnrolledRoutePosition | undefined

/** Bind a position lookup to the offsets of one unrolled route. */
function routePositionLookup(
  offsets: ReadonlyMap<TraceWire["wireIndex"], UnrolledWireOffset>,
): RoutePositionLookup {
  return ({
    id,
    position,
  }: Parameters<RoutePositionLookup>[0]): UnrolledRoutePosition | undefined => {
    const entry = offsets.get(id)
    if (!entry) return undefined
    return { net: entry.net, distance: entry.offset + position - entry.start }
  }
}

/** Selected section wires laid end to end per net, so a position on a wire becomes a distance along its net. */
export function routeUnrolled({
  view,
  wires,
}: {
  view: RouteView
  wires: readonly Pick<
    TraceWire,
    | "wireIndex"
    | "pcbTraceId"
    | "sourceTraceId"
    | "longitudinalMinMm"
    | "longitudinalMaxMm"
  >[]
}): UnrolledRoutes {
  const lengths = new Map<RouteNet, number>()
  const offsets = new Map<TraceWire["wireIndex"], UnrolledWireOffset>()
  for (const wire of wires) {
    if (!view.traces.has(wire.pcbTraceId)) continue
    const net = view.sources.get(wire.sourceTraceId)
    if (!net) continue
    offsets.set(wire.wireIndex, {
      net,
      offset: lengths.get(net) ?? 0,
      start: wire.longitudinalMinMm,
    })
    lengths.set(
      net,
      (lengths.get(net) ?? 0) + wire.longitudinalMaxMm - wire.longitudinalMinMm,
    )
  }
  return {
    lengths,
    along: routePositionLookup(offsets),
  }
}

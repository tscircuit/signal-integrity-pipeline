/* eslint-disable local/max-file-lines -- Keep the common route camera, glyphs and pane layouts together. */
import type {
  GraphicsObject,
  Line,
  NinePointAnchor,
  Point,
  Viewbox,
} from "graphics-debug"
import type { Snapshot } from "../kernel"
import { circuitJsonDb } from "./circuit-json-db"
import {
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "./connectivity"
import type { CopperScope } from "./geometry/scope"
import type {
  PcbPortId,
  PcbTraceId,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "./ids"
import type { RouteWire } from "./route-sections"
import type { CircuitJsonSnapshot } from "./schema"
import {
  type SimulationPcbDriverReceiverChannel,
  signalEndpointPortIds,
} from "./signals"

/** Fixed roles over the dark board; nets get their own bright hues. */
export const routeTones = {
  text: "#d6dde6",
  quiet: "#8b97a6",
  pane: "#11161c",
  paneEdge: "#2c3642",
  copper: "#9aa3ad",
  halo: "#0b0f13",
  slice: "#fbbf24",
  via: "#f8fafc",
  cell: "rgba(248, 250, 252, 0.85)",
  coupling: "rgba(192, 132, 252, 0.8)",
  threshold: "rgba(251, 191, 36, 0.16)",
  envelope: "rgba(203, 213, 225, 0.3)",
  failure: "#f87171",
} as const

/** One electrical net's drawing style; a differential pair shares a hue at two lightnesses. */
export interface RouteNet {
  label: string
  hue: number
  lightness: number
  color: string
  /** Bit period of the channel that drives this net, when one does. */
  unitIntervalSeconds?: number
  /** One leg of a differential pair. */
  differential: boolean
}

/** The fixed framing of one problem: the selected copper's focus, a pane slot beside it and their union. */
export interface RouteFrame {
  focus: Viewbox
  pane: Viewbox
  camera: Viewbox
  unit: number
}

/** The name of a declared driver/receiver channel. */
type SignalName = SimulationPcbDriverReceiverChannel["name"]

/** A problem's framing plus its nets, shared by every stage so the camera and colours never move. */
export interface RouteView extends RouteFrame {
  traces: Set<PcbTraceId>
  sources: Map<SourceTraceId, RouteNet>
  ports: Map<SourcePortId, RouteNet>
}

/** A hue as a colour; `lightness` separates differential legs and section tones. */
export function routeHue({
  hue,
  lightness = 62,
  alpha = 1,
}: {
  hue: number
  lightness?: number
  alpha?: number
}): string {
  return `hsla(${Math.round(hue) % 360}, 90%, ${lightness}%, ${alpha})`
}

/** Bounds of points, or undefined when there are none. */
export function routeBounds(points: readonly Point[]): Viewbox | undefined {
  if (!points.length) return
  let box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  }
  for (const point of points)
    box = {
      minX: Math.min(box.minX, point.x),
      maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y),
      maxY: Math.max(box.maxY, point.y),
    }
  return box
}

/** Bound the default number of sampled items in dense route drawings. */
const ROUTE_DISPLAY_LIMIT = 160

/** Deterministic display-only sampling; never changes the admitted copper or solver input. */
export function routeDisplayItems<T>({
  items,
  limit = ROUTE_DISPLAY_LIMIT,
}: {
  items: readonly T[]
  limit?: number
}): T[] {
  if (items.length <= limit) return [...items]
  return Array.from(
    { length: limit },
    (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))],
  )
}

/** Prefer a roughly 8:5 camera for a board and its stage pane. */
const CAMERA_ASPECT_RATIO = 1.6
/** Keep a small border around the copper and separate it from the pane. */
const CAMERA_BORDER = 0.06
const CAMERA_GAP = 0.03
/** Keep the stage pane legible in a compact camera. */
const MINIMUM_SIDE_PANE_HEIGHT_RATIO = 0.6
const MINIMUM_BOTTOM_PANE_WIDTH_RATIO = 0.35
/** Limit contact with large packages and extend the camera to nearby board edges. */
const FOCUS_REACH_RATIO = 0.25
/** Resolve a full cycle into 24 points for consistent via and pin outlines. */
const CIRCLE_SEGMENTS = 24
/** Keep failure text short enough to fit the stage pane. */
const FAILURE_LINE_LIMIT = 3

/** A focus box with a pane slot on whichever side brings the camera closest to 1.6:1. */
export function routeFrame(box: Viewbox): RouteFrame {
  const margin =
    Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3) * CAMERA_BORDER
  const focus = {
    minX: box.minX - margin,
    maxX: box.maxX + margin,
    minY: box.minY - margin,
    maxY: box.maxY + margin,
  }
  const width = focus.maxX - focus.minX
  const height = focus.maxY - focus.minY
  const gap = Math.max(width, height) * CAMERA_GAP
  const side = Math.max(
    MINIMUM_SIDE_PANE_HEIGHT_RATIO * height,
    CAMERA_ASPECT_RATIO * height - width,
  )
  const below = Math.max(
    MINIMUM_BOTTOM_PANE_WIDTH_RATIO * width,
    width / CAMERA_ASPECT_RATIO - height,
  )
  const sideAspect = (width + gap + side) / height
  const belowAspect = width / (height + gap + below)
  const right =
    Math.abs(Math.log(sideAspect / CAMERA_ASPECT_RATIO)) <=
    Math.abs(Math.log(belowAspect / CAMERA_ASPECT_RATIO))
  let pane = {
    minX: focus.minX,
    maxX: focus.maxX,
    minY: focus.minY - gap - below,
    maxY: focus.minY - gap,
  }
  if (right)
    pane = {
      minX: focus.maxX + gap,
      maxX: focus.maxX + gap + side,
      minY: focus.minY,
      maxY: focus.maxY,
    }
  const camera = {
    minX: Math.min(focus.minX, pane.minX),
    maxX: Math.max(focus.maxX, pane.maxX),
    minY: Math.min(focus.minY, pane.minY),
    maxY: Math.max(focus.maxY, pane.maxY),
  }
  return {
    focus,
    pane,
    camera,
    unit: Math.max(camera.maxX - camera.minX, camera.maxY - camera.minY) / 100,
  }
}

const views = new WeakMap<
  Snapshot<CopperScope>,
  WeakMap<CircuitJsonSnapshot, RouteView>
>()

/**
 * Selected copper plus its endpoint components frame the problem; nets follow electrical connectivity, and
 * differential channels pair two nets in one hue.
 */
export function routeView({
  circuit,
  scope,
}: {
  circuit: CircuitJsonSnapshot
  scope: Snapshot<CopperScope>
}): RouteView {
  const cached = views.get(scope)?.get(circuit)
  if (cached) return cached
  const db = circuitJsonDb(circuit)
  const traces = new Set(scope.channelPcbTraceIds)
  const points: Point[] = []
  const ends = new Set<PcbPortId>()
  const order: SourceTraceId[] = []
  for (const trace of db.pcb_trace.list()) {
    if (!traces.has(trace.pcb_trace_id)) continue
    if (trace.source_trace_id && !order.includes(trace.source_trace_id))
      order.push(trace.source_trace_id)
    for (const point of trace.route) {
      if (point.route_type !== "wire") continue
      points.push(point)
      for (const id of [point.start_pcb_port_id, point.end_pcb_port_id])
        if (id) ends.add(id)
    }
  }
  // Endpoint parts join the focus, but a large package (a BGA) only near the copper.
  const copper = routeBounds(points) ?? {
    minX: 0,
    maxX: 1,
    minY: 0,
    maxY: 1,
  }
  const reach =
    Math.max(copper.maxX - copper.minX, copper.maxY - copper.minY) *
    FOCUS_REACH_RATIO
  const components = new Set(
    db.pcb_port.list().flatMap((port) => {
      if (!ends.has(port.pcb_port_id) || !port.pcb_component_id) return []
      return [port.pcb_component_id]
    }),
  )
  for (const component of db.pcb_component.list()) {
    if (!components.has(component.pcb_component_id)) continue
    const corners = routeOutline(component)
    for (const corner of corners)
      points.push({
        x: Math.min(
          copper.maxX + reach,
          Math.max(copper.minX - reach, corner.x),
        ),
        y: Math.min(
          copper.maxY + reach,
          Math.max(copper.minY - reach, corner.y),
        ),
      })
  }
  const parts = routeBounds(points) ?? {
    minX: 0,
    maxX: 1,
    minY: 0,
    maxY: 1,
  }
  // A board edge just beyond the problem is framed too, so the camera never cuts a board a few millimetres short.
  const board = routeBoardBox(circuit)
  const reachX = (parts.maxX - parts.minX) * FOCUS_REACH_RATIO
  const reachY = (parts.maxY - parts.minY) * FOCUS_REACH_RATIO
  const box = { ...parts }
  if (parts.minX - board.minX <= reachX)
    box.minX = Math.min(board.minX, parts.minX)
  if (board.maxX - parts.maxX <= reachX)
    box.maxX = Math.max(board.maxX, parts.maxX)
  if (parts.minY - board.minY <= reachY)
    box.minY = Math.min(board.minY, parts.minY)
  if (board.maxY - parts.maxY <= reachY)
    box.maxY = Math.max(board.maxY, parts.maxY)
  const view = {
    ...routeFrame(box),
    traces,
    ...routeViewNets({ circuit, order }),
  }
  const byCircuit =
    views.get(scope) ?? new WeakMap<CircuitJsonSnapshot, RouteView>()
  byCircuit.set(circuit, view)
  views.set(scope, byCircuit)
  return view
}

/** Drawing styles keyed by source traces and their connected ports. */
type RouteNetStyles = Pick<RouteView, "sources" | "ports">

/** Selected source traces grouped with their electrically connected IDs. */
interface RouteSourceNet {
  ids: Set<SourcePortId | SourceNetId | SourceTraceId>
  sources: SourceTraceId[]
}

/** The endpoint ports and bit period used to style a channel. */
interface RouteChannelPorts {
  ends: SourcePortId[]
  legs: SourcePortId[]
  unitIntervalSeconds: number
}

/** Nets that share one hue, with an optional channel's name and bit period. */
interface RouteNetGroup {
  nets: RouteSourceNet[]
  name?: SignalName
  unitIntervalSeconds?: number
}

/** Resolve selected source traces to net styles, pairing differential legs by signal. */
function routeViewNets({
  circuit,
  order,
}: {
  circuit: CircuitJsonSnapshot
  order: SourceTraceId[]
}): RouteNetStyles {
  const db = circuitJsonDb(circuit)
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(db.toArray())
  const nets: RouteSourceNet[] = []
  const sourceTraces = db.source_trace.list()
  for (const id of order) {
    const source = sourceTraces.find((record) => record.source_trace_id === id)
    const seed =
      source?.connected_source_port_ids[0] ??
      source?.connected_source_net_ids?.[0]
    if (!seed) {
      nets.push({ ids: new Set([id]), sources: [id] })
      continue
    }
    const net = nets.find((entry) => entry.ids.has(seed))
    if (net) {
      net.sources.push(id)
      continue
    }
    nets.push({
      ids: sourceNetMembers({ connectivity, memberId: seed }),
      sources: [id],
    })
  }
  const channels = new Map<SignalName, RouteChannelPorts>()
  for (const signal of db.simulation_pcb_driver_receiver_channel.list()) {
    const legs = signalEndpointPortIds(signal.driver)
    channels.set(signal.name, {
      ends: [...legs, ...signal.receivers.flatMap(signalEndpointPortIds)],
      legs,
      unitIntervalSeconds: 1 / signal.bit_rate_bps,
    })
  }
  const units: RouteNetGroup[] = []
  for (const net of nets) {
    if (units.some((unit) => unit.nets.includes(net))) continue
    const [name, channel] =
      [...channels].find(([, entry]) =>
        entry.ends.some((port) => net.ids.has(port)),
      ) ?? []
    const unit = {
      nets: [net],
      name,
      unitIntervalSeconds: channel?.unitIntervalSeconds,
    }
    if (channel?.legs.length === 2) {
      const [positive, negative] = channel.legs.map((port) =>
        nets.find((entry) => entry.ids.has(port)),
      )
      if (positive && negative && positive !== negative)
        unit.nets = [positive, negative]
    }
    units.push(unit)
  }
  const sources = new Map<SourceTraceId, RouteNet>()
  const ports = new Map<SourcePortId, RouteNet>()
  const sourcePorts = new Set(
    db.source_port.list().map((port) => port.source_port_id),
  )
  for (const [i, unit] of units.entries())
    for (const [leg, net] of unit.nets.entries()) {
      const hue = 195 + (i * 360) / units.length
      const differential = unit.nets.length > 1
      let lightness = 62
      if (differential) lightness = [74, 48][leg]
      const port = [...net.ids].find((id) => sourcePorts.has(id))
      let label = port ?? net.sources[0]
      if (unit.name) {
        label = unit.name
        if (differential) label = `${label}${[" P", " N"][leg]}`
      }
      const style = {
        label,
        hue,
        lightness,
        color: routeHue({ hue, lightness }),
        unitIntervalSeconds: unit.unitIntervalSeconds,
        differential,
      }
      for (const id of net.sources) sources.set(id, style)
      for (const id of net.ids) ports.set(id, style)
    }
  return { sources, ports }
}

/** A drawing that carries its fixed camera as an invisible frame the board picture crops to. */
export function routeCanvas(frame?: RouteFrame): GraphicsObject {
  const drawing: GraphicsObject = {
    coordinateSystem: "cartesian",
    lines: [],
    circles: [],
    polygons: [],
    rects: [],
    texts: [],
  }
  if (frame)
    drawing.rects!.push({
      center: {
        x: (frame.camera.minX + frame.camera.maxX) / 2,
        y: (frame.camera.minY + frame.camera.maxY) / 2,
      },
      width: frame.camera.maxX - frame.camera.minX,
      height: frame.camera.maxY - frame.camera.minY,
      fill: "none",
      stroke: "none",
      label: "camera",
    })
  return drawing
}

/** Copper with its layer in the stroke: top solid, inner layers hollow, bottom dimmed. */
export function routeStroke({
  points,
  color,
  width,
  layer,
  label,
}: {
  points: Point[]
  color: string
  width: number
  layer: string
  label?: string
}): Line[] {
  const line = {
    points,
    strokeColor: color,
    strokeWidth: width,
    label,
  }
  if (layer === "top") return [line]
  if (layer === "bottom")
    return [
      line,
      {
        points,
        strokeColor: "rgba(11, 15, 19, 0.5)",
        strokeWidth: width,
        label,
      },
    ]
  return [
    line,
    {
      points,
      strokeColor: routeTones.halo,
      strokeWidth: width * 0.45,
      label,
    },
  ]
}

/** Contiguous points with the same copper layer and width. */
interface RouteRun {
  points: Point[]
  layer: string
  width: number
}
/** Resolve an optional net to a stroke colour. */
type RouteNetColor = (net: RouteNet | undefined) => string

/** Emit the current run of one layer and width. */
function drawRouteRun({
  style,
}: {
  style: {
    run?: RouteRun
    net?: RouteNet
    color?: RouteNetColor
  }
}): Line[] {
  const { run, net, color } = style
  if (!run || run.points.length <= 1) return []
  let strokeColor = net?.color ?? routeTones.copper
  if (color) strokeColor = color(net)
  return routeStroke({ ...run, color: strokeColor, label: net?.label })
}

/** Add the overlay's primitives after the drawing's existing primitives. */
export function withRouteDrawing({
  drawing,
  overlay,
}: {
  drawing: GraphicsObject
  overlay: GraphicsObject
}): GraphicsObject {
  return {
    ...drawing,
    lines: [...drawing.lines!, ...overlay.lines!],
    polygons: [...drawing.polygons!, ...overlay.polygons!],
    rects: [...drawing.rects!, ...overlay.rects!],
    texts: [...drawing.texts!, ...overlay.texts!],
  }
}

/** Selected copper as layer-aware strokes, one colour per net unless `color` overrides it. */
export function routeNets({
  circuit,
  view,
  traceIds = view.traces,
  color,
}: {
  circuit: CircuitJsonSnapshot
  view: RouteView
  traceIds?: Set<PcbTraceId>
  color?: RouteNetColor
}): NonNullable<GraphicsObject["lines"]> {
  const drawing = routeCanvas()
  const db = circuitJsonDb(circuit)
  const fallback = db.pcb_board.getWhere({})?.min_trace_width ?? 0.15
  for (const trace of db.pcb_trace.list()) {
    if (!traceIds.has(trace.pcb_trace_id)) continue
    const net = view.sources.get(trace.source_trace_id ?? "")
    let run: RouteRun | undefined
    for (const point of trace.route) {
      if (point.route_type !== "wire") {
        drawing.lines!.push(...drawRouteRun({ style: { run, net, color } }))
        run = undefined
        continue
      }
      const width = point.width || fallback
      if (!run || run.layer !== point.layer || run.width !== width) {
        const points = run?.points.slice(-1) ?? []
        drawing.lines!.push(...drawRouteRun({ style: { run, net, color } }))
        run = { points, layer: point.layer, width }
      }
      run.points.push({ x: point.x, y: point.y })
    }
    drawing.lines!.push(...drawRouteRun({ style: { run, net, color } }))
  }
  return drawing.lines!
}

/** A closed circle outline as polygon points. */
function circle({
  center,
  radius,
}: {
  center: Point
  radius: number
}): Point[] {
  return Array.from(
    {
      length: CIRCLE_SEGMENTS,
    },
    (_, i) => ({
      x: center.x + radius * Math.cos((i * Math.PI) / (CIRCLE_SEGMENTS / 2)),
      y: center.y + radius * Math.sin((i * Math.PI) / (CIRCLE_SEGMENTS / 2)),
    }),
  )
}

/**
 * Pin marks over a dark halo, a dot for a driver and a ring for anything that listens, never wider than their
 * spacing allows.
 */
export function routeMarks({
  marks,
  unit,
}: {
  marks: readonly {
    point: Point
    color: string
    driver: boolean
    label?: string
  }[]
  unit: number
}): NonNullable<GraphicsObject["polygons"]> {
  const drawing = routeCanvas()
  const radius = Math.min(
    unit * 1.1,
    spacing(marks.map((mark) => mark.point)) * 0.38,
  )
  for (const mark of marks) {
    drawing.polygons!.push({
      points: circle({ center: mark.point, radius: radius * 1.25 }),
      fill: routeTones.halo,
      stroke: "none",
      label: mark.label,
    })
    if (mark.driver) {
      drawing.polygons!.push({
        points: circle({ center: mark.point, radius }),
        fill: mark.color,
        stroke: "none",
        label: mark.label,
      })
      continue
    }
    drawing.polygons!.push({
      points: circle({ center: mark.point, radius: radius * 0.8 }),
      stroke: mark.color,
      strokeWidth: radius * 0.4,
      label: mark.label,
    })
  }
  return drawing.polygons!
}

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
  circuit: CircuitJsonSnapshot
  sourcePortId: SourcePortId
}): Point | undefined {
  const port = circuitJsonDb(circuit).pcb_port.getWhere({
    source_port_id: sourcePortId,
  })
  if (!port) return undefined
  return { x: port.x, y: port.y }
}

/** One label on a route drawing. */
type RouteText = NonNullable<GraphicsObject["texts"]>[number]

/** Small world-unit text; drawn only where a number cannot be shown by shape or colour. */
export function routeText({
  x,
  y,
  text,
  color,
  size,
  anchor = "center",
}: {
  x: number
  y: number
  text: string
  color: string
  size: number
  anchor?: NinePointAnchor
}): RouteText {
  return {
    x,
    y,
    text,
    color,
    fontSize: size,
    anchorSide: anchor,
  }
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

/** Find up to three spans ending at whitespace or the end of the message. */
function failureLines({
  message,
  perLine,
}: {
  message: string
  perLine: number
}): string[] {
  const lines: string[] = []
  // Preserve the literal-count match when the line width is nonfinite.
  let literalCount = ""
  let width = perLine
  if (!Number.isFinite(perLine)) {
    literalCount = `{1,${perLine}}`
    width = 1
  }
  let start = 0
  while (start < message.length && lines.length < FAILURE_LINE_LIMIT) {
    let boundary = start
    const limit = Math.min(start + width, message.length)
    for (let end = start + 1; end <= limit; end++) {
      if ("\r\n\u2028\u2029".includes(message[end - 1])) break
      if (!message.startsWith(literalCount, end)) continue
      const after = end + literalCount.length
      if (after === message.length || message[after].trim() === "")
        boundary = after
    }
    if (boundary === start) {
      start++
      continue
    }
    lines.push(message.slice(start, boundary + 1))
    start = boundary + 1
  }
  if (lines.length === 0) return [message]
  return lines
}

/** A failure reason in the pane slot (or across the board without one), wrapped to at most three lines that fit. */
export function routeFailure({
  box,
  message,
}: {
  box: Viewbox
  message: string
}): NonNullable<GraphicsObject["texts"]> {
  const drawing = routeCanvas()
  const width = box.maxX - box.minX
  const size = Math.min((box.maxY - box.minY) * 0.06, width / 40)
  const perLine = Math.max(10, Math.floor((width * 0.9) / (size * 0.6)))
  const lines = failureLines({ message, perLine })
  for (const [i, line] of lines.entries())
    drawing.texts!.push(
      routeText({
        x: box.minX + width * 0.05,
        y: box.maxY - size * (1.6 + i * 1.3),
        text: line.trim(),
        color: routeTones.failure,
        size,
        anchor: "center_left",
      }),
    )
  return drawing.texts!
}

/** The board's extent: its outline, its rectangle, else every positioned pcb record. */
export function routeBoardBox(circuit: CircuitJsonSnapshot): Viewbox {
  const board = circuitJsonDb(circuit).pcb_board.getWhere({})
  if (board?.outline?.length) return routeBounds(board.outline)!
  if (board?.width && board.height)
    return {
      minX: board.center.x - board.width / 2,
      maxX: board.center.x + board.width / 2,
      minY: board.center.y - board.height / 2,
      maxY: board.center.y + board.height / 2,
    }
  const points = circuit.flatMap((record) => {
    if (!record.type.startsWith("pcb_") || !("x" in record) || !("y" in record))
      return []
    if (typeof record.x !== "number" || typeof record.y !== "number") return []
    return [{ x: record.x, y: record.y }]
  })
  return (
    routeBounds(points) ?? {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    }
  )
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
  circuit: CircuitJsonSnapshot
  scope: Snapshot<CopperScope> | undefined
  color?: RouteNetColor
}): GraphicsObject {
  if (!scope) return routeCanvas()
  const view = routeView({ circuit, scope })
  const drawing = routeCanvas(view)
  drawing.lines!.push(
    ...routeNets({
      circuit,
      view,
      color,
    }),
  )
  return drawing
}

/** Closest spacing between distinct points, so glyphs never overlap their neighbours. */
function spacing(points: readonly Point[]): number {
  let closest = Infinity
  for (const [i, a] of points.entries())
    for (const b of points.slice(i + 1)) {
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (distance > 1e-9) closest = Math.min(closest, distance)
    }
  return closest
}

/** Which way the selected copper leaves a pin, as a unit vector (east when no copper touches it). */
export function routePinDirection({
  circuit,
  view,
  pin,
}: {
  circuit: CircuitJsonSnapshot
  view: RouteView
  pin: Point
}): Point {
  for (const trace of circuitJsonDb(circuit).pcb_trace.list()) {
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

type RouteBuffer = {
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
    spacing(buffers.map((buffer) => buffer.point)) * 0.48,
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

/** A component's outline as a rotated rectangle. */
export function routeOutline(component: {
  center: Point
  width: number
  height: number
  rotation?: number
}): Point[] {
  const ccwRotationRadians = ((component.rotation ?? 0) * Math.PI) / 180
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const x = (sx * component.width) / 2
    const y = (sy * component.height) / 2
    return {
      x:
        component.center.x +
        x * Math.cos(ccwRotationRadians) -
        y * Math.sin(ccwRotationRadians),
      y:
        component.center.y +
        x * Math.sin(ccwRotationRadians) +
        y * Math.cos(ccwRotationRadians),
    }
  })
}

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
}): GraphicsObject {
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
  circuit: CircuitJsonSnapshot
  view: RouteView
}): RouteStripRow[] {
  const lengths = new Map<RouteNet, number>()
  for (const trace of circuitJsonDb(circuit).pcb_trace.list()) {
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
  id: RouteWire["id"]
  position: number
}) => UnrolledRoutePosition | undefined

/** Bind a position lookup to the offsets of one unrolled route. */
function routePositionLookup(
  offsets: ReadonlyMap<RouteWire["id"], UnrolledWireOffset>,
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
  wires: readonly Pick<RouteWire, "id" | "trace" | "source" | "start" | "end">[]
}): UnrolledRoutes {
  const lengths = new Map<RouteNet, number>()
  const offsets = new Map<RouteWire["id"], UnrolledWireOffset>()
  for (const wire of wires) {
    if (!view.traces.has(wire.trace)) continue
    const net = view.sources.get(wire.source)
    if (!net) continue
    offsets.set(wire.id, {
      net,
      offset: lengths.get(net) ?? 0,
      start: wire.start,
    })
    lengths.set(net, (lengths.get(net) ?? 0) + wire.end - wire.start)
  }
  return {
    lengths,
    along: routePositionLookup(offsets),
  }
}

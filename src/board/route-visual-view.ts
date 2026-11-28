import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type { Point, Viewbox } from "graphics-debug"
import type { Snapshot } from "../kernel"
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
import { getBoardBounds, getPointBounds } from "./plan-view"
import type { CircuitJson } from "./schema"
import {
  endpointPorts,
  type SimulationPcbDriverReceiverChannel,
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

/** Bound the default number of sampled items in dense route drawings. */
const ROUTE_DISPLAY_LIMIT = 160

/** Deterministic display-only sampling; never changes the selected copper or solver input. */
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
  WeakMap<CircuitJson, RouteView>
>()

/**
 * Selected copper plus its endpoint components frame the problem; nets follow electrical connectivity, and
 * differential channels pair two nets in one hue.
 */
export function routeView({
  circuit,
  scope,
}: {
  circuit: CircuitJson
  scope: Snapshot<CopperScope>
}): RouteView {
  const cached = views.get(scope)?.get(circuit)
  if (cached) return cached
  const db = cju([...circuit])
  const traces = new Set(scope.channelPcbTraceIds)
  const points: Point[] = []
  const ends = new Set<PcbPortId>()
  for (const trace of db.pcb_trace.list()) {
    if (!traces.has(trace.pcb_trace_id)) continue
    for (const point of trace.route) {
      if (point.route_type !== "wire") continue
      points.push(point)
      for (const id of [point.start_pcb_port_id, point.end_pcb_port_id])
        if (id) ends.add(id)
    }
  }
  // Endpoint parts join the focus, but a large package (a BGA) only near the copper.
  const copper = getPointBounds(points) ?? {
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
  const parts = getPointBounds(points) ?? {
    minX: 0,
    maxX: 1,
    minY: 0,
    maxY: 1,
  }
  // A board edge just beyond the problem is framed too, so the camera never cuts a board a few millimetres short.
  const board = getBoardBounds(db)
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
    ...routeViewNets({ db, traces }),
  }
  const byCircuit = views.get(scope) ?? new WeakMap<CircuitJson, RouteView>()
  byCircuit.set(circuit, view)
  views.set(scope, byCircuit)
  return view
}

/** Drawing styles keyed by source traces and their connected ports. */
type RouteNetStyles = Pick<RouteView, "sources" | "ports">

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
  db,
  traces,
}: {
  db: CircuitJsonUtilObjects
  traces: ReadonlySet<PcbTraceId>
}): RouteNetStyles {
  const nets = routeSourceNets({ db, traces })
  const channels = new Map<SignalName, RouteChannelPorts>()
  for (const signal of db.simulation_pcb_driver_receiver_channel.list()) {
    const legs = endpointPorts(signal.driver)
    channels.set(signal.name, {
      ends: [...legs, ...signal.receivers.flatMap(endpointPorts)],
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

/** Selected source traces grouped with their electrically connected IDs. */
export interface RouteSourceNet {
  ids: Set<SourcePortId | SourceNetId | SourceTraceId>
  sources: SourceTraceId[]
  firstSourceTraceId: SourceTraceId
}

/** Group traces by their source connectivity in first PCB trace order. */
/** @internal */
export function routeSourceNets({
  db,
  traces,
}: {
  db: CircuitJsonUtilObjects
  traces: ReadonlySet<PcbTraceId>
}): RouteSourceNet[] {
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(db.toArray())
  const nets = new Map<
    SourcePortId | SourceNetId | SourceTraceId,
    RouteSourceNet
  >()
  const sourceTraces = new Map(
    db.source_trace.list().map((trace) => [trace.source_trace_id, trace]),
  )
  const visited = new Set<SourceTraceId>()
  for (const pcbTrace of db.pcb_trace.list()) {
    const id = pcbTrace.source_trace_id
    if (
      !traces.has(pcbTrace.pcb_trace_id) ||
      id === undefined ||
      visited.has(id)
    )
      continue
    visited.add(id)
    const source = sourceTraces.get(id)
    const port = source?.connected_source_port_ids[0]
    const sourceNet = source?.connected_source_net_ids?.[0]
    let seed = id
    if (port !== undefined) seed = port
    else if (sourceNet !== undefined) seed = sourceNet
    const existing = nets.get(seed)
    if (existing !== undefined) {
      existing.sources.push(id)
      continue
    }
    const ids = sourceNetMembers({ connectivity, memberId: seed })
    const net = { ids, sources: [id], firstSourceTraceId: id }
    for (const memberId of ids) nets.set(memberId, net)
  }
  return [...new Set(nets.values())]
}

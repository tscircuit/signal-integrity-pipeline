import {
  type Box,
  Point as PlanarPoint,
  type Polygon,
  Vector,
} from "@flatten-js/core"
import {
  circlePolygon,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import type {
  LayerRef,
  PcbComponent,
  PcbPort,
  PcbTrace,
  PcbTraceRoutePointVia,
  PcbTraceRoutePointWire,
  Point,
  SourceTrace,
} from "circuit-json"
import { findConnectedNetworks } from "circuit-json-to-connectivity-map"
import type { CircuitJson, SourceNetId, SourcePortId } from "../board"

/** A quantized point or the key of a copper feature that acts as one junction. */
export type CopperPointKey = string
/** Distinct physical neighbors at each junction. */
export type CopperGraph = Record<CopperPointKey, Set<CopperPointKey>>
/** Selected PCB terminal junctions by their source port. */
export type CopperTerminals = ReadonlyMap<SourcePortId, CopperPointKey[]>
/** Copper adjacency and the terminals it connects to. */
interface RoutedCopper {
  graph: CopperGraph
  terminals: CopperTerminals
  routed: ReadonlySet<CopperPointKey>
}

/** An outline on one layer with a key shared across a pad or barrel. */
interface CopperRegion {
  layer: LayerRef
  outline: Polygon
  key: CopperPointKey
}

/** The interval along a wire occupied by one copper contact. */
interface CopperContact {
  key: CopperPointKey
  start: number
  end: number
}

/** One wire segment with the contacts that will split it into graph edges. */
interface CopperWire {
  layer: LayerRef
  outline: Polygon
  origin: PlanarPoint
  direction: Vector
  length: number
  contacts: CopperContact[]
}

/** One group of keys to collapse to a single junction. */
type CopperGroup = CopperPointKey[]

/** A layer's copper outline and cached bounds, with its original graph feature. */
interface CopperFeature {
  copper: CopperWire | CopperRegion
  box: Box
}

/** Outlines and junctions contributed by pads and standalone vias. */
interface RegionCopper {
  regions: CopperRegion[]
  groups: CopperGroup[]
}

/** Copper and junctions carried by the trace route itself. */
interface TraceCopper extends RegionCopper {
  wires: CopperWire[]
}

/** A wire's ordered path and its collapsed contact intervals. */
interface WireJunctions {
  route: CopperGroup
  groups: CopperGroup[]
}

/** A route point that can end a wire. Through-pad copper comes from the pad record. */
type WireEnd = PcbTraceRoutePointWire | PcbTraceRoutePointVia

/** Source ports and routes admitted to physical topology validation. */
interface CopperSelection {
  circuit: CircuitJson
  ports: PcbPort[]
  traces: PcbTrace[]
  selected: ReadonlySet<SourceNetId | SourcePortId>
  rails: ReadonlySet<SourceNetId | SourcePortId>
  traceIds: ReadonlySet<SourceTrace["source_trace_id"]>
}

/** Point grid spacing and maximum outline separation treated as contact, in millimeters. */
const COPPER_TOLERANCE_MM = 1e-5

/** Keep physical point identity stable across routes on the same layer. */
function pointKey({
  point,
  layer,
}: {
  point: Point
  layer: LayerRef
}): CopperPointKey {
  const x = Math.round(point.x / COPPER_TOLERANCE_MM)
  const y = Math.round(point.y / COPPER_TOLERANCE_MM)
  return `${x},${y},${layer}`
}

/** Compare the occupied outline on either side of a possible copper contact. */
function outlineContact({ a, b }: { a: Polygon; b: Polygon }): PlanarPoint[] {
  const points = [
    ...a.intersect(b),
    ...a.vertices.filter((point) => b.contains(point)),
    ...b.vertices.filter((point) => a.contains(point)),
  ]
  if (points.length) return points
  const [distance, nearest] = a.distanceTo(b)
  if (distance > COPPER_TOLERANCE_MM) return []
  return [nearest.start, nearest.end]
}

/** Project the actual area of copper contact onto the length of a wire. */
function registerContact({
  wire,
  key,
  points,
}: {
  wire: CopperWire
  key: CopperPointKey
  points: PlanarPoint[]
}): void {
  const positions = points.map((point) =>
    Math.max(
      0,
      Math.min(wire.length, new Vector(wire.origin, point).dot(wire.direction)),
    ),
  )
  wire.contacts.push({
    key,
    start: Math.min(...positions),
    end: Math.max(...positions),
  })
}

/** Find coplanar outline contacts with a sweep along each layer's x axis. */
function outlineContacts({
  wires,
  regions,
}: {
  wires: CopperWire[]
  regions: CopperRegion[]
}): CopperGroup[] {
  const features: CopperFeature[] = [...wires, ...regions]
    .map((copper) => ({
      copper,
      box: copper.outline.box,
    }))
    .sort(
      (a, b) =>
        a.copper.layer.localeCompare(b.copper.layer) || a.box.xmin - b.box.xmin,
    )
  const groups: CopperGroup[] = []
  for (const [index, { copper: a, box }] of features.entries()) {
    const search = box.extend(COPPER_TOLERANCE_MM)
    for (
      let otherIndex = index + 1;
      otherIndex < features.length;
      otherIndex++
    ) {
      const { copper: b, box: bounds } = features[otherIndex]
      if (a.layer !== b.layer || search.xmax < bounds.xmin) break
      if (!search.intersect(bounds)) continue
      const points = outlineContact({ a: a.outline, b: b.outline })
      if (!points.length) continue
      if ("key" in a) {
        if ("key" in b) groups.push([a.key, b.key])
        else registerContact({ wire: b, key: a.key, points })
        continue
      }
      if ("key" in b) {
        registerContact({ wire: a, key: b.key, points })
        continue
      }
      const key = `contact:${index}:${otherIndex}`
      registerContact({ wire: a, key, points })
      registerContact({ wire: b, key, points })
    }
  }
  return groups
}

/** Read a via's approached layer or the wire layer at a route point. */
function routeLayer({
  point,
  side,
}: {
  point: WireEnd
  side: "from_layer" | "to_layer"
}): LayerRef {
  if (point.route_type === "via") return point[side]
  return point.layer
}

/** Build one wire, reading taper widths from the route point that supplies the wire. */
function routeWire({
  start,
  end,
}: {
  start: WireEnd
  end: WireEnd
}): CopperWire | undefined {
  const layer = routeLayer({ point: start, side: "to_layer" })
  if (layer !== routeLayer({ point: end, side: "from_layer" })) return
  const first = pointKey({ point: start, layer })
  const last = pointKey({ point: end, layer })
  if (first === last) return
  let wire = start
  if (wire.route_type === "via") wire = end
  if (wire.route_type === "via") return
  const { start_width = wire.width, end_width = start_width } = wire
  const origin = new PlanarPoint(start.x, start.y)
  const vector = new Vector(origin, new PlanarPoint(end.x, end.y))
  const length = vector.length
  return {
    layer,
    outline: getTraceSegmentPolygon(start, end, start_width, end_width),
    origin,
    direction: vector.normalize(),
    length,
    contacts: [
      { key: first, start: 0, end: 0 },
      { key: last, start: length, end: length },
    ],
  }
}

/** Build the wires and barrel connections encoded directly in each selected route. */
function traceCopper(traces: PcbTrace[]): TraceCopper {
  const wires: CopperWire[] = []
  const regions: CopperRegion[] = []
  const groups: CopperGroup[] = []
  for (const { route } of traces) {
    for (const [index, end] of route.entries()) {
      if (end.route_type === "via") {
        const layers = [end.from_layer, end.to_layer]
        const key = pointKey({ point: end, layer: end.from_layer })
        groups.push([key, pointKey({ point: end, layer: end.to_layer })])
        if (end.outer_diameter !== undefined) {
          const outline = circlePolygon(end, end.outer_diameter / 2)
          for (const layer of layers) regions.push({ layer, outline, key })
        }
      }
      if (index === 0) continue
      const start = route[index - 1]
      if (
        start.route_type === "through_pad" ||
        end.route_type === "through_pad"
      )
        continue
      const wire = routeWire({ start, end })
      if (wire) wires.push(wire)
    }
  }
  return { wires, regions, groups }
}

/** Use only pads linked to selected PCB ports and vias associated with selected nets or routes. */
function copperRegions({
  circuit,
  ports,
  traces,
  selected,
  rails,
  traceIds,
}: CopperSelection): RegionCopper {
  const selectedPorts = new Map(ports.map((port) => [port.pcb_port_id, port]))
  const selectedTraces = new Set(traces.map((trace) => trace.pcb_trace_id))
  const rotations = new Map<PcbComponent["pcb_component_id"], number>(
    circuit
      .filter((record) => record.type === "pcb_component")
      .map((record) => [record.pcb_component_id, record.rotation]),
  )
  const regions: CopperRegion[] = []
  const groups: CopperGroup[] = []
  for (const record of circuit) {
    if (record.type === "pcb_via") {
      const { source_net_id, source_trace_id, pcb_trace_id } = record
      const onNet =
        source_net_id !== undefined &&
        selected.has(source_net_id) &&
        !rails.has(source_net_id)
      const onTrace =
        source_trace_id !== undefined && traceIds.has(source_trace_id)
      const onRoute =
        pcb_trace_id !== undefined && selectedTraces.has(pcb_trace_id)
      if (!onNet && !onTrace && !onRoute) continue
      const outline = circlePolygon(record, record.outer_diameter / 2)
      for (const layer of record.layers)
        regions.push({ layer, outline, key: record.pcb_via_id })
      continue
    }
    if (record.type !== "pcb_smtpad" && record.type !== "pcb_plated_hole")
      continue
    if (record.pcb_port_id === undefined) continue
    const port = selectedPorts.get(record.pcb_port_id)
    if (!port) continue
    if (record.type === "pcb_smtpad") {
      regions.push({
        layer: record.layer,
        outline: getSmtPadPolygon(record),
        key: pointKey({ point: port, layer: record.layer }),
      })
      continue
    }
    let rotation: number | undefined
    if (record.pcb_component_id !== undefined)
      rotation = rotations.get(record.pcb_component_id)
    const outline = getPlatedHolePolygon(record, rotation)
    for (const layer of record.layers)
      regions.push({ layer, outline, key: record.pcb_plated_hole_id })
    groups.push([
      record.pcb_plated_hole_id,
      ...record.layers.map((layer) => pointKey({ point: port, layer })),
    ])
  }
  return { regions, groups }
}

/** Collapse overlapping contact intervals and keep the order of disjoint junctions on a wire. */
function wireJunctions(contacts: CopperContact[]): WireJunctions {
  const [first, ...rest] = contacts.toSorted((a, b) => a.start - b.start)
  let current = first
  const route = [first.key]
  const groups: CopperGroup[] = []
  for (const contact of rest) {
    if (contact.start <= current.end + COPPER_TOLERANCE_MM) {
      groups.push([current.key, contact.key])
      if (contact.end > current.end) current = contact
      continue
    }
    route.push(contact.key)
    current = contact
  }
  return { route, groups }
}

/** Add an undirected edge between two distinct copper junctions. */
export function joinCopperPoints({
  graph,
  a,
  b,
}: {
  graph: CopperGraph
  a: CopperPointKey
  b: CopperPointKey
}): void {
  if (a === b) return
  graph[a].add(b)
  graph[b].add(a)
}

/** Resolve the copper junctions and connect each pair of consecutive stops on a trace. */
export function buildRoutedCopper(selection: CopperSelection): RoutedCopper {
  const pads = copperRegions(selection)
  const { wires, regions, groups: barrels } = traceCopper(selection.traces)
  const contacts = outlineContacts({
    wires,
    regions: [...pads.regions, ...regions],
  })
  const ordered = wires.map(({ contacts }) => wireJunctions(contacts))
  const terminalPoints = selection.ports.flatMap((port) =>
    port.layers.map((layer) => ({
      port: port.source_port_id,
      key: pointKey({ point: port, layer }),
    })),
  )
  const groups = [
    ...pads.groups,
    ...barrels,
    ...contacts,
    ...ordered.flatMap(({ route, groups }) => [
      ...groups,
      ...route.map((key) => [key]),
    ]),
    ...terminalPoints.map(({ key }) => [key]),
  ]
  const networks = Object.entries(findConnectedNetworks(groups))
  const junctions = Object.fromEntries(
    networks.flatMap(([id, keys]) => keys.map((key) => [key, id])),
  )
  const graph: CopperGraph = Object.fromEntries(
    networks.map(([id]) => [id, new Set<CopperPointKey>()]),
  )
  const routed = new Set<CopperPointKey>()
  for (const { route: keys } of ordered) {
    for (const [index, key] of keys.entries()) {
      const a = junctions[key]
      routed.add(a)
      if (index === 0) continue
      joinCopperPoints({ graph, a, b: junctions[keys[index - 1]] })
    }
  }
  const terminals = new Map<SourcePortId, CopperPointKey[]>()
  for (const { port, key } of terminalPoints) {
    const terminal = terminals.get(port)
    if (terminal) terminal.push(junctions[key])
    else terminals.set(port, [junctions[key]])
  }
  return { graph, terminals, routed }
}

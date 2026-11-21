import { Box } from "@flatten-js/core"
import {
  getPlatedHolePolygon,
  getPourPolygon,
  getSmtPadPolygon,
} from "@tscircuit/circuit-json-util"
import {
  all_layers,
  type LayerRef,
  type PcbBoard,
  type PcbPlatedHole,
  type PcbSmtPad,
  type PcbTrace,
  type PcbVia,
  type SourceTrace,
} from "circuit-json"
import {
  type ConnectivityMap,
  type PassiveBridge,
  passiveBridges,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "../connectivity"
import { fail } from "../diagnostics"
import type {
  PcbPortId,
  PcbTraceId,
  PcbViaId,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "../ids"
import type { CircuitJson } from "../schema"
import type { RoutedPoint } from "./types"

/** Copper can be retained one layer above or below the selected copper. */
const ADJACENT_LAYER_OFFSET = 1

/** Copper and electrical nets kept by the channel proximity screen. */
export interface CopperScope {
  lateralDistanceMm: number
  selectedPcbTraceIds: PcbTraceId[]
  pcbTraceIds: PcbTraceId[]
  pcbViaIds: PcbViaId[]
  railTraceIds: PcbTraceId[]
  retainedSourceIds: SourceConnectionGroup
}

/** Bounds in board millimetres and the inclusive span of occupied layer indices. */
interface CopperBox {
  xy: Box
  firstLayer: number
  lastLayer: number
}

/** A surface-mount pad or plated hole with its copper outline. */
type Pad = PcbSmtPad | PcbPlatedHole

/** Bounding boxes associated with one PCB trace record. */
type TraceBoxes = [traceId: PcbTraceId, boxes: CopperBox[]]

/** Ports and nets associated with PCB traces and their routed vias. */
interface CopperAssociations {
  sources: Map<SourceTraceId, SourceTrace>
  traceSources: Map<PcbTraceId, SourceTraceId | undefined>
}

/** Bounds of the selected copper and the lateral screening distance. */
interface CopperProximity {
  seeds: CopperBox[]
  distanceMm: number
}

/** Electrical nets that may expand beyond their nearby copper. */
interface RetainedCopper {
  connectivity: ConnectivityMap
  retained: Set<SourcePortId | SourceNetId>
}

/** Caller supplies selected channel nets and identifies the AC ground and supply nets. */
interface CopperScopeOptions {
  circuit: CircuitJson
  connectivity: ConnectivityMap
  selected: ReadonlySet<SourcePortId | SourceNetId>
  reference: ReadonlySet<SourcePortId | SourceNetId>
  rails: ReadonlySet<SourcePortId | SourceNetId>
  distanceMm: number
}

/** A signal pour on a source net that can seed or join the scope. */
interface ScopedPour {
  net: SourceNetId
  box: CopperBox
}

/** Ports and nets associated with routing stay independent of spatial proximity. */
function traceMembers({
  id,
  sources,
}: {
  id: SourceTraceId | undefined
  sources: Map<SourceTraceId, SourceTrace>
}): SourceConnectionGroup {
  if (!id) return []
  const trace = sources.get(id)
  if (!trace) return []
  return [
    ...trace.connected_source_port_ids,
    ...(trace.connected_source_net_ids ?? []),
  ]
}

/** Copper layer names in top-to-bottom order. */
function copperLayers(board: PcbBoard): LayerRef[] {
  const layers = all_layers.slice(0, board.num_layers)
  layers.push(...layers.splice(1, 1))
  return layers
}

/** Attach a planar bound to the span of copper layers occupied by the feature. */
function copperBox({
  xy,
  names,
  layers,
}: {
  xy: Box
  names: readonly LayerRef[]
  layers: readonly LayerRef[]
}): CopperBox {
  const indices = names.map((name) => layers.indexOf(name))
  return {
    xy,
    firstLayer: Math.min(...indices),
    lastLayer: Math.max(...indices),
  }
}

/** A tapered wire can reach either of its specified edge widths. */
function wireRadius(point: RoutedPoint): number {
  if (point.route_type === "via") return 0
  const widths = [point.width, point.end_width]
  return Math.max(...widths.filter((width) => width !== undefined)) / 2
}

/** Bound a wire by the widest radius at its endpoints and its approach and exit layers. */
function segmentBox({
  start,
  end,
  layers,
}: {
  start: RoutedPoint
  end: RoutedPoint
  layers: readonly LayerRef[]
}): CopperBox {
  const radius = Math.max(wireRadius(start), wireRadius(end))
  const xy = new Box(
    Math.min(start.x, end.x) - radius,
    Math.min(start.y, end.y) - radius,
    Math.max(start.x, end.x) + radius,
    Math.max(start.y, end.y) + radius,
  )
  const names: LayerRef[] = []
  if (end.route_type === "via") {
    names.push(end.from_layer)
  } else {
    names.push(end.layer)
    if (start.route_type === "via") names.push(start.to_layer)
    else names.push(start.layer)
  }
  return copperBox({ xy, names, layers })
}

/** Bound wire segments. Through-pad primitives are outside the routed solver’s geometry. */
function traceBoxes({
  trace,
  layers,
}: {
  trace: PcbTrace
  layers: readonly LayerRef[]
}): TraceBoxes {
  const boxes = trace.route.slice(1).flatMap((end, index) => {
    const start = trace.route[index]
    if (start.route_type === "through_pad" || end.route_type === "through_pad")
      return []
    return [segmentBox({ start, end, layers })]
  })
  return [trace.pcb_trace_id, boxes]
}

/** Native route vias can inherit their electrical association from the PCB trace. */
function viaMembers({
  via,
  associations,
}: {
  via: PcbVia
  associations: CopperAssociations
}): SourceConnectionGroup {
  const { sources, traceSources } = associations
  let sourceTraceId = via.source_trace_id
  if (sourceTraceId === undefined && via.pcb_trace_id !== undefined)
    sourceTraceId = traceSources.get(via.pcb_trace_id)
  const ids = traceMembers({ id: sourceTraceId, sources })
  if (via.source_net_id) ids.push(via.source_net_id)
  return ids
}

/** The physical barrel span includes any inactive stubs. */
function viaBox({
  via,
  layers,
  blindViasAllowed,
}: {
  via: PcbVia
  layers: readonly LayerRef[]
  blindViasAllowed: boolean
}): CopperBox {
  const { topmost_drill_layer: top, bottommost_drill_layer: bottom } = via
  const radius = via.outer_diameter / 2
  const { x, y } = via
  const xy = new Box(x - radius, y - radius, x + radius, y + radius)
  if (
    via.through_hole === true ||
    (!blindViasAllowed && top === undefined && bottom === undefined)
  )
    return copperBox({ xy, names: layers, layers })
  const names = [...via.layers]
  if (top !== undefined) names.push(top)
  if (bottom !== undefined) names.push(bottom)
  return copperBox({ xy, names, layers })
}

/** Bound component pad copper using the same outlines as routed topology. */
function padBox({
  pad,
  layers,
}: {
  pad: Pad
  layers: readonly LayerRef[]
}): CopperBox {
  if (pad.type === "pcb_smtpad")
    return copperBox({
      xy: getSmtPadPolygon(pad).box,
      names: [pad.layer],
      layers,
    })
  const xy = getPlatedHolePolygon(pad).box
  return copperBox({ xy, names: pad.layers, layers })
}

/** Euclidean distance between bounding boxes is a lower bound on copper distance. */
function isNearby({
  candidate,
  proximity,
}: {
  candidate: CopperBox
  proximity: CopperProximity
}): boolean {
  const { seeds, distanceMm } = proximity
  return seeds.some((seed) => {
    const adjacentLayers =
      candidate.firstLayer <= seed.lastLayer + ADJACENT_LAYER_OFFSET &&
      seed.firstLayer <= candidate.lastLayer + ADJACENT_LAYER_OFFSET
    if (!adjacentLayers) return false

    const xGap = Math.max(
      0,
      seed.xy.xmin - candidate.xy.xmax,
      candidate.xy.xmin - seed.xy.xmax,
    )
    const yGap = Math.max(
      0,
      seed.xy.ymin - candidate.xy.ymax,
      candidate.xy.ymin - seed.xy.ymax,
    )
    return Math.hypot(xGap, yGap) <= distanceMm
  })
}

/** Retain the entire electrical net, with all branches and endpoint terminations. */
function retain({
  ids,
  copper,
}: {
  ids: SourceConnectionGroup
  copper: RetainedCopper
}): void {
  const { connectivity, retained } = copper
  for (const id of ids) {
    if (retained.has(id)) continue
    for (const connected of sourceNetMembers({ connectivity, seed: id }))
      retained.add(connected)
  }
}

/** Follow passive bridges until every port reachable from the retained nets is included. */
function retainPassiveBridges({
  bridges,
  copper,
}: {
  bridges: PassiveBridge[]
  copper: RetainedCopper
}): void {
  let changed = true
  while (changed) {
    changed = false
    for (const pins of bridges) {
      if (!pins.some((pin) => copper.retained.has(pin))) continue
      for (const pin of pins) {
        if (copper.retained.has(pin)) continue
        retain({ ids: [pin], copper })
        changed = true
      }
    }
  }
}

/**
 * Board-world XY in mm (+X right, +Y top); layers ordered top to bottom.
 * Conservative segment bounding boxes retain copper on the same/adjacent layers
 * within the caller's admission cap in XY. Signal nets are retained in full.
 * The selected set covers the entire channel, including both sides of series passives.
 * Return and supply traces stay local. Reference barrels remain eligible board-wide.
 * Copper without a net association is ignored, including unlinked vias, traces
 * without a source trace and pours without a source net.
 * The cap is not an electromagnetic error bound.
 */
export function channelCopperScope({
  circuit,
  connectivity,
  selected,
  reference,
  rails,
  distanceMm,
}: CopperScopeOptions): CopperScope {
  if (!Number.isFinite(distanceMm) || distanceMm < 0) {
    fail(
      "simulation_scope",
      "Copper scope distance must be finite and non-negative",
    )
  }
  const board = circuit.find((record) => record.type === "pcb_board")!
  const layers = copperLayers(board)
  const blindViasAllowed = board.allow_blind_and_buried_vias === true
  const traces = circuit.filter((record) => record.type === "pcb_trace")
  const vias = circuit.filter((record) => record.type === "pcb_via")
  const pours = circuit.filter((record) => record.type === "pcb_copper_pour")
  const pcbPorts = circuit.filter((record) => record.type === "pcb_port")
  const ports = new Map<PcbPortId, SourcePortId>(
    pcbPorts.map((port) => [port.pcb_port_id, port.source_port_id]),
  )
  const pads = circuit.filter(
    (record) =>
      record.type === "pcb_smtpad" || record.type === "pcb_plated_hole",
  )
  const sourceTraces = circuit.filter(
    (record) => record.type === "source_trace",
  )
  const sources = new Map<SourceTraceId, SourceTrace>(
    sourceTraces.map((trace) => [trace.source_trace_id, trace]),
  )
  const traceSources = new Map(
    traces.map((trace) => [trace.pcb_trace_id, trace.source_trace_id]),
  )
  const associations = { sources, traceSources }
  const boxes = new Map(traces.map((trace) => traceBoxes({ trace, layers })))
  const railIds = new Set([...rails, ...reference])
  const signalPours = pours.flatMap((pour): ScopedPour[] => {
    const net = pour.source_net_id
    if (!net || railIds.has(net)) return []
    const box = copperBox({
      xy: getPourPolygon(pour).box,
      names: [pour.layer],
      layers,
    })
    return [{ net, box }]
  })
  const selectedTraces = traces.filter((trace) => {
    return traceMembers({ id: trace.source_trace_id, sources }).some((id) =>
      selected.has(id),
    )
  })
  const seeds = selectedTraces.flatMap(
    (trace) => boxes.get(trace.pcb_trace_id)!,
  )
  for (const pad of pads) {
    const sourcePort = pad.pcb_port_id && ports.get(pad.pcb_port_id)
    if (!sourcePort || !selected.has(sourcePort)) continue
    seeds.push(padBox({ pad, layers }))
  }
  for (const via of vias) {
    if (!viaMembers({ via, associations }).some((id) => selected.has(id)))
      continue
    seeds.push(viaBox({ via, layers, blindViasAllowed }))
  }
  for (const { net, box } of signalPours) {
    if (selected.has(net)) seeds.push(box)
  }
  const proximity = { seeds, distanceMm }
  const retained = new Set(selected)
  const retainedCopper = { connectivity, retained }
  const railTraceIds = new Set<PcbTraceId>()
  const nearbyRailVias = new Set<PcbViaId>()
  for (const trace of traces) {
    if (
      !boxes
        .get(trace.pcb_trace_id)!
        .some((box) => isNearby({ candidate: box, proximity }))
    )
      continue
    const ids = traceMembers({ id: trace.source_trace_id, sources })
    if (ids.some((id) => railIds.has(id))) {
      railTraceIds.add(trace.pcb_trace_id)
      continue
    }
    retain({ ids, copper: retainedCopper })
  }
  for (const via of vias) {
    if (
      !isNearby({
        candidate: viaBox({ via, layers, blindViasAllowed }),
        proximity,
      })
    )
      continue
    const ids = viaMembers({ via, associations })
    if (ids.some((id) => railIds.has(id))) {
      nearbyRailVias.add(via.pcb_via_id)
      continue
    }
    retain({ ids, copper: retainedCopper })
  }
  for (const pad of pads) {
    const port = pad.pcb_port_id && ports.get(pad.pcb_port_id)
    if (
      !port ||
      railIds.has(port) ||
      !isNearby({ candidate: padBox({ pad, layers }), proximity })
    )
      continue
    retain({ ids: [port], copper: retainedCopper })
  }
  for (const { net, box } of signalPours) {
    if (isNearby({ candidate: box, proximity }))
      retain({ ids: [net], copper: retainedCopper })
  }
  const bridges = passiveBridges({ circuit, excluded: railIds })
  retainPassiveBridges({ bridges, copper: retainedCopper })
  const keptTraces = traces.filter((trace) => {
    if (railTraceIds.has(trace.pcb_trace_id)) return true
    return traceMembers({ id: trace.source_trace_id, sources }).some((id) =>
      retained.has(id),
    )
  })
  const keptVias = vias.filter((via) => {
    if (nearbyRailVias.has(via.pcb_via_id)) return true
    return viaMembers({ via, associations }).some(
      (id) => retained.has(id) || reference.has(id),
    )
  })
  return {
    lateralDistanceMm: distanceMm,
    selectedPcbTraceIds: selectedTraces.map((trace) => trace.pcb_trace_id),
    pcbTraceIds: keptTraces.map((trace) => trace.pcb_trace_id),
    pcbViaIds: keptVias.map((via) => via.pcb_via_id),
    railTraceIds: [...railTraceIds],
    retainedSourceIds: [...retained],
  }
}

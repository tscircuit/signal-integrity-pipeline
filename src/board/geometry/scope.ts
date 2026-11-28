import { cju, getPourPolygon } from "@tscircuit/circuit-json-util"
import {
  all_layers,
  type LayerRef,
  type PcbBoard,
  type PcbVia,
  type SourceTrace,
} from "circuit-json"
import {
  type ConnectivityMap,
  getTraceMembers,
  type PassiveBridge,
  passiveBridges,
  type SourceConnectionGroup,
  sourceNetMembers,
} from "../connectivity"
import { fail } from "../diagnostics"
import type {
  PcbCopperPourId,
  PcbPortId,
  PcbTraceId,
  PcbViaId,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "../ids"
import type { CircuitJson } from "../schema"
import {
  type CopperBounds,
  type CopperBox,
  copperBox,
  getChannelCopperBounds,
  type Pad,
  padBox,
  traceBoxes,
  viaBox,
} from "./scope-bounds"

/** Nearby copper can be one layer above or below the channel copper. */
const ADJACENT_LAYER_OFFSET = 1

/** Copper and electrical nets kept by the channel proximity screen. */
export interface CopperScope {
  /** Largest XY gap between copper bounds that counts as nearby. */
  nearbyGapMm: number
  /** Envelope of the channel copper used as the seed of the nearby search. */
  channelCopperBounds?: CopperBounds
  /** The channel's own traces. */
  channelPcbTraceIds: PcbTraceId[]
  /** Traces from the channel, nearby signal nets and nearby rails. */
  extractedPcbTraceIds: PcbTraceId[]
  /** Vias for field extraction, including reference vias across the board. */
  extractedPcbViaIds: PcbViaId[]
  /** Pours on the declared reference and supply nets. */
  referencePcbCopperPourIds: PcbCopperPourId[]
  /** Supply or ground traces near the channel, kept as local copper only. */
  nearbyRailPcbTraceIds: PcbTraceId[]
  /** Source ports and nets included with their full electrical nets. */
  extractedSourceIds: SourceConnectionGroup
}

/** Ports and nets associated with PCB traces and their routed vias. */
interface CopperAssociations {
  sources: Map<SourceTraceId, SourceTrace>
  traceSources: Map<PcbTraceId, SourceTraceId | undefined>
}

/** Bounds of the channel copper and the maximum nearby XY gap. */
interface CopperProximity {
  channelBoxes: CopperBox[]
  nearbyGapMm: number
}

/** Channel, AC ground and supply source port and net IDs, with the proximity distance. */
interface CopperScopeOptions {
  circuit: CircuitJson
  connectivity: ConnectivityMap
  channelSourceIds: ReadonlySet<SourcePortId | SourceNetId>
  referenceSourceIds: ReadonlySet<SourcePortId | SourceNetId>
  railSourceIds: ReadonlySet<SourcePortId | SourceNetId>
  distanceMm: number
}

/** Scope result and the channel's occupied bounds used by its proximity screen. */
interface CopperScopeWithBounds {
  scope: CopperScope
  channelBoxes: CopperBox[]
}

/** A signal pour that contributes channel bounds or admits a nearby net. */
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
  return getTraceMembers(trace)
}

/** Copper layer names in top-to-bottom order. */
function copperLayers(board: PcbBoard): LayerRef[] {
  const boardLayers = all_layers.slice(0, board.num_layers)
  boardLayers.push(...boardLayers.splice(1, 1))
  return boardLayers
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

/** Euclidean distance between bounding boxes is a lower bound on copper distance. */
function isNearby({
  candidate,
  proximity,
}: {
  candidate: CopperBox
  proximity: CopperProximity
}): boolean {
  const { channelBoxes, nearbyGapMm } = proximity
  return channelBoxes.some((channelBox) => {
    const adjacentLayers =
      candidate.firstLayer <= channelBox.lastLayer + ADJACENT_LAYER_OFFSET &&
      channelBox.firstLayer <= candidate.lastLayer + ADJACENT_LAYER_OFFSET
    if (!adjacentLayers) return false

    const xGap = Math.max(
      0,
      channelBox.xy.xmin - candidate.xy.xmax,
      candidate.xy.xmin - channelBox.xy.xmax,
    )
    const yGap = Math.max(
      0,
      channelBox.xy.ymin - candidate.xy.ymax,
      candidate.xy.ymin - channelBox.xy.ymax,
    )
    return Math.hypot(xGap, yGap) <= nearbyGapMm
  })
}

/** Expand nearby nets in discovery order and include nets reached through passive bridges. */
function expandedSourceIds({
  nearbySourceIds,
  channelSourceIds,
  connectivity,
  bridges,
}: {
  nearbySourceIds: SourceConnectionGroup
  channelSourceIds: ReadonlySet<SourcePortId | SourceNetId>
  connectivity: ConnectivityMap
  bridges: PassiveBridge[]
}): SourceConnectionGroup {
  const extractedSourceIds = new Set(channelSourceIds)
  for (const id of nearbySourceIds) {
    if (extractedSourceIds.has(id)) continue
    for (const connected of sourceNetMembers({ connectivity, memberId: id }))
      extractedSourceIds.add(connected)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const pins of bridges) {
      if (!pins.some((pin) => extractedSourceIds.has(pin))) continue
      for (const pin of pins) {
        if (extractedSourceIds.has(pin)) continue
        for (const connected of sourceNetMembers({
          connectivity,
          memberId: pin,
        }))
          extractedSourceIds.add(connected)
        changed = true
      }
    }
  }
  return [...extractedSourceIds]
}

/** Select the channel's copper and its nearby copper. */
export function channelCopperScope(options: CopperScopeOptions): CopperScope {
  return channelCopperScopeWithBounds(options).scope
}

/**
 * Board-world XY is in mm (+X right, +Y top). Layers run top to bottom.
 * Conservative bounding boxes admit copper on the same or adjacent layers
 * within the caller's XY distance. The scope includes these signal nets in full.
 * The channel source IDs include both sides of each series passive.
 * Return and supply traces stay local. Reference barrels remain eligible board-wide.
 * Copper without a net association is ignored, including unlinked vias, traces
 * without a source trace and pours without a source net.
 * The cap is not an electromagnetic error bound.
 */
export function channelCopperScopeWithBounds({
  circuit,
  connectivity,
  channelSourceIds,
  referenceSourceIds,
  railSourceIds,
  distanceMm: nearbyGapMm,
}: CopperScopeOptions): CopperScopeWithBounds {
  if (!Number.isFinite(nearbyGapMm) || nearbyGapMm < 0) {
    fail(
      "simulation_scope",
      "Copper scope distance must be finite and non-negative",
    )
  }
  const db = cju([...circuit])
  const board = db.pcb_board.getWhere({})!
  const boardLayers = copperLayers(board)
  const blindViasAllowed = board.allow_blind_and_buried_vias === true
  const traces = db.pcb_trace.list()
  const vias = db.pcb_via.list()
  const pours = db.pcb_copper_pour.list()
  const pcbPorts = db.pcb_port.list()
  const sourcePortIdByPcbPortId = new Map<PcbPortId, SourcePortId>(
    pcbPorts.map((pcbPort) => [pcbPort.pcb_port_id, pcbPort.source_port_id]),
  )
  const padRecords = new Set<CircuitJson[number]>([
    ...db.pcb_smtpad.list(),
    ...db.pcb_plated_hole.list(),
  ])
  // Preserve the order of interleaved pads when adding their nets.
  const pads = circuit.filter((record): record is Pad => padRecords.has(record))
  const sourceTraces = db.source_trace.list()
  const sources = new Map<SourceTraceId, SourceTrace>(
    sourceTraces.map((trace) => [trace.source_trace_id, trace]),
  )
  const traceSources = new Map(
    traces.map((trace) => [trace.pcb_trace_id, trace.source_trace_id]),
  )
  const associations = { sources, traceSources }
  const boxes = new Map(
    traces.map((trace) => traceBoxes({ trace, boardLayers })),
  )
  const referenceAndRailSourceIds = new Set([
    ...railSourceIds,
    ...referenceSourceIds,
  ])
  const signalPours = pours.flatMap((pour): ScopedPour[] => {
    const net = pour.source_net_id
    if (!net || referenceAndRailSourceIds.has(net)) return []
    const box = copperBox({
      xy: getPourPolygon(pour).box,
      occupiedLayers: [pour.layer],
      boardLayers,
    })
    return [{ net, box }]
  })
  const channelTraces = traces.filter((trace) => {
    return traceMembers({ id: trace.source_trace_id, sources }).some((id) =>
      channelSourceIds.has(id),
    )
  })
  const channelBoxes = channelTraces.flatMap(
    (trace) => boxes.get(trace.pcb_trace_id)!,
  )
  for (const pad of pads) {
    if (pad.pcb_port_id === undefined) continue
    const sourcePortId = sourcePortIdByPcbPortId.get(pad.pcb_port_id)
    if (sourcePortId === undefined || !channelSourceIds.has(sourcePortId))
      continue
    channelBoxes.push(padBox({ pad, boardLayers }))
  }
  for (const via of vias) {
    if (
      !viaMembers({ via, associations }).some((id) => channelSourceIds.has(id))
    )
      continue
    channelBoxes.push(viaBox({ via, boardLayers, blindViasAllowed }))
  }
  for (const { net, box } of signalPours) {
    if (channelSourceIds.has(net)) channelBoxes.push(box)
  }
  const proximity = { channelBoxes, nearbyGapMm }
  const nearbySourceIds: SourceConnectionGroup = []
  const nearbyRailPcbTraceIds = new Set<PcbTraceId>()
  const nearbyRailPcbViaIds = new Set<PcbViaId>()
  for (const trace of traces) {
    if (
      !boxes
        .get(trace.pcb_trace_id)!
        .some((box) => isNearby({ candidate: box, proximity }))
    )
      continue
    const ids = traceMembers({ id: trace.source_trace_id, sources })
    if (ids.some((id) => referenceAndRailSourceIds.has(id))) {
      nearbyRailPcbTraceIds.add(trace.pcb_trace_id)
      continue
    }
    for (const id of ids) nearbySourceIds.push(id)
  }
  for (const via of vias) {
    if (
      !isNearby({
        candidate: viaBox({ via, boardLayers, blindViasAllowed }),
        proximity,
      })
    )
      continue
    const ids = viaMembers({ via, associations })
    if (ids.some((id) => referenceAndRailSourceIds.has(id))) {
      nearbyRailPcbViaIds.add(via.pcb_via_id)
      continue
    }
    for (const id of ids) nearbySourceIds.push(id)
  }
  for (const pad of pads) {
    if (pad.pcb_port_id === undefined) continue
    const sourcePortId = sourcePortIdByPcbPortId.get(pad.pcb_port_id)
    if (
      sourcePortId === undefined ||
      referenceAndRailSourceIds.has(sourcePortId) ||
      !isNearby({ candidate: padBox({ pad, boardLayers }), proximity })
    )
      continue
    nearbySourceIds.push(sourcePortId)
  }
  for (const { net, box } of signalPours) {
    if (isNearby({ candidate: box, proximity })) nearbySourceIds.push(net)
  }
  const bridges = passiveBridges({
    circuit,
    excluded: referenceAndRailSourceIds,
  })
  const extractedSourceIds = expandedSourceIds({
    nearbySourceIds,
    channelSourceIds,
    connectivity,
    bridges,
  })
  const extracted = new Set(extractedSourceIds)
  const extractedTraces = traces.filter((trace) => {
    if (nearbyRailPcbTraceIds.has(trace.pcb_trace_id)) return true
    return traceMembers({ id: trace.source_trace_id, sources }).some((id) =>
      extracted.has(id),
    )
  })
  const extractedVias = vias.filter((via) => {
    if (nearbyRailPcbViaIds.has(via.pcb_via_id)) return true
    return viaMembers({ via, associations }).some(
      (id) => extracted.has(id) || referenceSourceIds.has(id),
    )
  })
  return {
    channelBoxes,
    scope: {
      nearbyGapMm,
      channelCopperBounds: getChannelCopperBounds(channelBoxes),
      channelPcbTraceIds: channelTraces.map((trace) => trace.pcb_trace_id),
      extractedPcbTraceIds: extractedTraces.map((trace) => trace.pcb_trace_id),
      extractedPcbViaIds: extractedVias.map((via) => via.pcb_via_id),
      referencePcbCopperPourIds: pours
        .filter(
          (pour) =>
            pour.source_net_id !== undefined &&
            referenceAndRailSourceIds.has(pour.source_net_id),
        )
        .map((pour) => pour.pcb_copper_pour_id),
      nearbyRailPcbTraceIds: [...nearbyRailPcbTraceIds],
      extractedSourceIds,
    },
  }
}

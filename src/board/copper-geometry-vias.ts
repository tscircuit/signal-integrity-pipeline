import type { cju } from "@tscircuit/circuit-json-util"
import type { PcbVia } from "circuit-json"
import type { SourceConnectionGroup } from "./connectivity"
import type { CopperVia } from "./copper-geometry-types"
import type { PcbViaId, SourceTraceId } from "./ids"
import type { LayerRef } from "./schema"

/** Convert physical via records, including standalone vias, to geometry. */
export function readCopperVia(via: PcbVia): CopperVia {
  return {
    pcbViaId: via.pcb_via_id,
    pcbTraceId: via.pcb_trace_id,
    sourceTraceId: via.source_trace_id,
    sourceNetId: via.source_net_id,
    point: [via.x, via.y],
    layers: via.layers,
    outerDiameterMm: via.outer_diameter,
    holeDiameterMm: via.hole_diameter,
  }
}

/** Validate declared copper layers before applying the board's via policy. */
function getViaLayers({
  via,
  boardLayers,
  allowsBlindVias,
}: {
  via: CopperVia
  boardLayers: readonly LayerRef[]
  allowsBlindVias: boolean
}): LayerRef[] {
  const viaId = via.pcbViaId || via.pcbTraceId
  if (!via.layers.length) throw new Error(`via ${viaId}: missing copper layers`)
  const layerIndices = via.layers.map((layer) => {
    const layerIndex = boardLayers.indexOf(layer)
    if (layerIndex < 0)
      throw new Error(`via ${viaId}: unknown copper layer ${layer}`)
    return layerIndex
  })
  if (!allowsBlindVias) return [...boardLayers]
  const firstLayerIndex = Math.min(...layerIndices)
  const lastLayerIndex = Math.max(...layerIndices)
  const layers = boardLayers.slice(firstLayerIndex, lastLayerIndex + 1)
  if (layerIndices[0] > layerIndices[layerIndices.length - 1]) layers.reverse()
  return layers
}

/** Resolve the canonical barrel span and keep one entry for each physical via. */
export function collectCopperVias({
  scopedVias,
  embeddedVias,
  boardLayers,
  allowsBlindVias,
}: {
  scopedVias: CopperVia[]
  embeddedVias: CopperVia[]
  boardLayers: readonly LayerRef[]
  allowsBlindVias: boolean
}): CopperVia[] {
  const seenPcbViaIds = new Set<PcbViaId>()
  const vias: CopperVia[] = []
  for (const via of [...scopedVias, ...embeddedVias]) {
    if (via.pcbViaId !== undefined) {
      if (seenPcbViaIds.has(via.pcbViaId)) continue
      seenPcbViaIds.add(via.pcbViaId)
    }
    const layers = getViaLayers({ via, boardLayers, allowsBlindVias })
    vias.push({ ...via, layers })
  }
  return vias
}

/** Read every declared via association for the pad-to-via net check. */
export function getViaMembers({
  db,
  via,
  traceMembers,
}: {
  db: ReturnType<typeof cju>
  via: CopperVia
  traceMembers: ReadonlyMap<SourceTraceId, SourceConnectionGroup>
}): SourceConnectionGroup {
  const members: SourceConnectionGroup = []
  if (via.sourceTraceId !== undefined)
    members.push(...(traceMembers.get(via.sourceTraceId) || []))
  if (via.pcbTraceId !== undefined) {
    const sourceTraceId = db.pcb_trace.get(via.pcbTraceId)?.source_trace_id
    if (sourceTraceId !== undefined && sourceTraceId !== via.sourceTraceId)
      members.push(...(traceMembers.get(sourceTraceId) || []))
  }
  if (via.sourceNetId !== undefined) members.push(via.sourceNetId)
  return members
}

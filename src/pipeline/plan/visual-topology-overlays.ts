import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { PlanOverlay, SourceNetId, SourcePortId } from "../../board"
import type { CircuitNodes, ReceiverGraphs } from "../../simulation"

/** Draw only relevant series passives and ideal wires, keeping distinct explicit joins. */
export function buildTopologyOverlays({
  db,
  graphs,
  activeSourcePortIds,
  placedSourcePortIds,
  spiceNodeNamesBySourceContactId,
}: {
  db: CircuitJsonUtilObjects
  graphs: ReceiverGraphs
  activeSourcePortIds: ReadonlySet<SourcePortId>
  placedSourcePortIds: ReadonlySet<SourcePortId>
  spiceNodeNamesBySourceContactId: CircuitNodes["mapping"]
}): PlanOverlay[] {
  const overlays: PlanOverlay[] = []
  for (const { evidence } of graphs.channelConnections) {
    if (evidence.sourceTraceId !== undefined) continue
    const { fromSourcePortId, toSourcePortId } = evidence
    overlays.push({
      fromSourcePortId,
      toSourcePortId,
      kind: "series",
      label: "Series passive",
    })
  }
  const overlaySourcePortIds = new Set([
    ...activeSourcePortIds,
    ...overlays.flatMap(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
  ])
  const activeSpiceNodeNames = new Set(
    [...overlaySourcePortIds].map(
      (sourcePortId) => spiceNodeNamesBySourceContactId[sourcePortId],
    ),
  )
  const sourcePortIdsBySourceNetId = new Map<SourceNetId, Set<SourcePortId>>()
  const seen = new Set<string>()
  for (const connection of graphs.wireConnections) {
    const pins = connection.filter(
      (sourcePortId) =>
        placedSourcePortIds.has(sourcePortId) &&
        activeSpiceNodeNames.has(
          spiceNodeNamesBySourceContactId[sourcePortId],
        ) &&
        spiceNodeNamesBySourceContactId[sourcePortId] !== "0",
    )
    const [fromSourcePortId, ...targets] = pins
    for (const toSourcePortId of targets) {
      const key = [fromSourcePortId, toSourcePortId].sort().join(" ")
      if (seen.has(key)) continue
      seen.add(key)
      overlays.push({
        fromSourcePortId,
        toSourcePortId,
        kind: "ideal",
        label: "Ideal connection",
      })
    }
    for (const sourceContactId of connection) {
      const sourceNet = db.source_net.get(sourceContactId)
      if (!sourceNet) continue
      const sourceNetId = sourceNet.source_net_id
      const sourcePortIds =
        sourcePortIdsBySourceNetId.get(sourceNetId) || new Set()
      for (const sourcePortId of pins) sourcePortIds.add(sourcePortId)
      sourcePortIdsBySourceNetId.set(sourceNetId, sourcePortIds)
    }
  }
  for (const [
    fromSourcePortId,
    ...targets
  ] of sourcePortIdsBySourceNetId.values()) {
    for (const toSourcePortId of targets) {
      const key = [fromSourcePortId, toSourcePortId].sort().join(" ")
      if (seen.has(key)) continue
      seen.add(key)
      overlays.push({
        fromSourcePortId,
        toSourcePortId,
        kind: "ideal",
        label: "Ideal net connection",
      })
    }
  }
  return overlays
}

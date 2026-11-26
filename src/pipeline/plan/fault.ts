import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { PlanOverlay, SourcePortId, SourceTraceId } from "../../board"
import type { Diagnostic } from "../../kernel"
import type { PlanPath } from "./visual"
import type { PlanTopology } from "./visual-topology"

/** Fault ports and traces are selected only from the current attempt's evidence. */
export interface PlanFault {
  sourcePortIds: Set<SourcePortId>
  sourceTraceIds: Set<SourceTraceId>
  overlays: PlanOverlay[]
  incompletePaths: PlanPath[]
}

/** Diagnose open legs and collapsed or bypassed connections from the evidence. */
export function resolvePlanFault({
  db,
  issue,
  paths,
  topology,
  partiallyRoutedSourcePortIds,
}: {
  db: CircuitJsonUtilObjects
  partiallyRoutedSourcePortIds: ReadonlySet<SourcePortId>
  issue?: Diagnostic
  paths: readonly PlanPath[]
  topology?: PlanTopology
}): PlanFault {
  const sourcePortIds = new Set<SourcePortId>()
  const sourceTraceIds = new Set<SourceTraceId>()
  const overlays: PlanOverlay[] = []
  for (const { id: recordId, kind } of issue?.subjects || []) {
    if (kind !== "record") continue
    if (db.source_port.get(recordId)) sourcePortIds.add(recordId)
    if (db.source_trace.get(recordId)) sourceTraceIds.add(recordId)
  }
  const incompletePaths: PlanPath[] = []
  if (issue?.code === "channel_short") {
    for (const overlay of topology?.overlays || []) {
      if (
        overlay.kind !== "ideal" ||
        !sourcePortIds.has(overlay.fromSourcePortId) ||
        !sourcePortIds.has(overlay.toSourcePortId)
      )
        continue
      overlays.push({ ...overlay, kind: "short", label: "Bypass" })
    }
  } else if (
    issue?.code === "channel_net" ||
    issue?.code === "channel_receiver_terminal_missing"
  ) {
    for (const path of paths) {
      const { legLabel, fromSourcePortId, toSourcePortId } = path
      if (
        !sourcePortIds.has(fromSourcePortId) ||
        !sourcePortIds.has(toSourcePortId)
      )
        continue
      incompletePaths.push(path)
      if (
        partiallyRoutedSourcePortIds.has(fromSourcePortId) ||
        partiallyRoutedSourcePortIds.has(toSourcePortId)
      )
        continue
      overlays.push({
        fromSourcePortId,
        toSourcePortId,
        kind: "missing",
        label: `${legLabel} · No routed source path`,
      })
    }
  }
  return { sourcePortIds, sourceTraceIds, overlays, incompletePaths }
}

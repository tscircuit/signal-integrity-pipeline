import {
  getTraceColor,
  type PlanVisualEndpoint,
  planColors,
  type SourcePortId,
} from "../../board"
import type { CircuitNodes } from "../../simulation"
import type { PlanPath } from "./visual"
import type { PlanTopology } from "./visual-topology"

/** Keep the binding node in geometry hover labels. */
function formatEndpointLabel({
  sourcePortId,
  labels,
  spiceNodeNamesBySourceContactId,
}: {
  sourcePortId: SourcePortId
  labels: ReadonlyMap<SourcePortId, string>
  spiceNodeNamesBySourceContactId?: CircuitNodes["mapping"]
}): string {
  const label = labels.get(sourcePortId) || sourcePortId
  const spiceNodeName = spiceNodeNamesBySourceContactId?.[sourcePortId]
  if (spiceNodeName !== undefined) return `${label} (${spiceNodeName})`
  return label
}

/** Keep one glyph per physical declaration, with drivers taking precedence. */
export function buildEndpoints({
  paths,
  topology,
  labels,
}: {
  paths: readonly PlanPath[]
  topology?: PlanTopology
  labels: ReadonlyMap<SourcePortId, string>
}): PlanVisualEndpoint[] {
  const endpoints = new Map<SourcePortId, PlanVisualEndpoint>()
  const tracesBySourceTraceId = new Map(
    topology?.traces.map((trace) => [trace.sourceTraceId, trace]),
  )
  const resolved = new Map(
    topology?.paths.map((path) => [path.toSourcePortId, path.pathSegments]),
  )
  for (const { legLabel, fromSourcePortId, toSourcePortId } of paths) {
    const pathSegments = resolved.get(toSourcePortId)
    const firstTrace = pathSegments?.find((segment) => segment.kind === "trace")
    const lastTrace = pathSegments?.findLast(
      (segment) => segment.kind === "trace",
    )
    const driverTrace =
      firstTrace && tracesBySourceTraceId.get(firstTrace.sourceTraceId)
    const receiverTrace =
      lastTrace && tracesBySourceTraceId.get(lastTrace.sourceTraceId)
    let driverColor: string = planColors.existing
    if (driverTrace) driverColor = getTraceColor(driverTrace.index)
    if (endpoints.get(fromSourcePortId)?.kind !== "driver")
      endpoints.set(fromSourcePortId, {
        sourcePortId: fromSourcePortId,
        kind: "driver",
        towardSourcePortId: firstTrace?.toSourcePortId || toSourcePortId,
        color: driverColor,
        label: `${legLabel} · Driver ${formatEndpointLabel({ sourcePortId: fromSourcePortId, labels, spiceNodeNamesBySourceContactId: topology?.spiceNodeNamesBySourceContactId })}`,
      })
    if (!endpoints.has(toSourcePortId)) {
      const isIdeal =
        pathSegments !== undefined &&
        (pathSegments.length === 0 || pathSegments.at(-1)?.kind === "ideal")
      let kind: PlanVisualEndpoint["kind"] = "receiver"
      let color: string = planColors.existing
      if (receiverTrace) color = getTraceColor(receiverTrace.index)
      if (isIdeal) {
        kind = "ideal"
        color = planColors.ideal
      }
      endpoints.set(toSourcePortId, {
        sourcePortId: toSourcePortId,
        kind,
        color,
        label: `${legLabel} · Receiver ${formatEndpointLabel({ sourcePortId: toSourcePortId, labels, spiceNodeNamesBySourceContactId: topology?.spiceNodeNamesBySourceContactId })}`,
      })
    }
  }
  for (const {
    fromSourcePortId,
    toSourcePortId,
    isOnReceiverPath,
    index,
  } of topology?.traces || []) {
    if (isOnReceiverPath) continue
    for (const sourcePortId of [fromSourcePortId, toSourcePortId])
      if (!endpoints.has(sourcePortId))
        endpoints.set(sourcePortId, {
          sourcePortId,
          kind: "extraTraceEnd",
          color: getTraceColor(index),
          label: `Extra trace end · ${formatEndpointLabel({ sourcePortId, labels, spiceNodeNamesBySourceContactId: topology?.spiceNodeNamesBySourceContactId })}`,
        })
  }
  return [...endpoints.values()]
}

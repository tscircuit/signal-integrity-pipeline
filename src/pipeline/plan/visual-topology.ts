import { cju } from "@tscircuit/circuit-json-util"
import {
  cloneCircuitJson,
  type PlanOverlay,
  type PlanTrace,
  type SourcePortId,
  type SourceTraceId,
} from "../../board"
import { Diagnostic } from "../../kernel"
import {
  buildReceiverGraphs,
  type CircuitNodes,
  findReceiverPath,
  numberCircuitNodes,
  type ReceiverGraphs,
  type TraceContacts,
  validateRoutedNodes,
} from "../../simulation"
import type { TransientChannelSimulationPlan } from "../transient-channel-simulation-plan"
import type { PlanPath } from "./visual"
import { buildTopologyOverlays } from "./visual-topology-overlays"

/** Presentation data for the electrical partitions before rendering the board. */
export interface PlanTopology {
  traces: PlanTrace[]
  paths: ResolvedPlanPath[]
  overlays: PlanOverlay[]
  spiceNodeNamesBySourceContactId: CircuitNodes["mapping"]
  issue?: Diagnostic
}

/** One ordered trace, series part, or ideal connection between route contacts. */
export type PlanPathSegment = Pick<
  PlanPath,
  "fromSourcePortId" | "toSourcePortId"
> &
  (
    | { kind: "trace"; sourceTraceId: SourceTraceId }
    | { kind: "series" | "ideal" }
  )

/** Ordered segments traversed by one driver-to-receiver connection. */
export interface ResolvedPlanPath extends PlanPath {
  pathSegments: PlanPathSegment[]
}

/** Orient each connection and join adjacent contacts in the same ideal group. */
function resolvePath({
  path,
  graphs,
  spiceNodeNamesBySourceContactId,
}: {
  path: PlanPath
  graphs: ReceiverGraphs
  spiceNodeNamesBySourceContactId: CircuitNodes["mapping"]
}): ResolvedPlanPath {
  const edges = findReceiverPath({
    graphs,
    fromSourcePortId: path.fromSourcePortId,
    toSourcePortId: path.toSourcePortId,
    allowUnroutedTraces: true,
  })
  const pathSegments: PlanPathSegment[] = []
  let current = path.fromSourcePortId
  for (const {
    fromSourcePortId: firstSourcePortId,
    toSourcePortId: secondSourcePortId,
    sourceTraceId,
  } of edges || []) {
    let fromSourcePortId = firstSourcePortId
    let toSourcePortId = secondSourcePortId
    if (
      current === toSourcePortId ||
      (current !== fromSourcePortId &&
        spiceNodeNamesBySourceContactId[current] !==
          spiceNodeNamesBySourceContactId[fromSourcePortId] &&
        spiceNodeNamesBySourceContactId[current] ===
          spiceNodeNamesBySourceContactId[toSourcePortId])
    ) {
      fromSourcePortId = secondSourcePortId
      toSourcePortId = firstSourcePortId
    }
    if (current !== fromSourcePortId)
      pathSegments.push({
        kind: "ideal",
        fromSourcePortId: current,
        toSourcePortId: fromSourcePortId,
      })
    if (sourceTraceId === undefined)
      pathSegments.push({ kind: "series", fromSourcePortId, toSourcePortId })
    else
      pathSegments.push({
        kind: "trace",
        sourceTraceId,
        fromSourcePortId,
        toSourcePortId,
      })
    current = toSourcePortId
  }
  if (edges && current !== path.toSourcePortId)
    pathSegments.push({
      kind: "ideal",
      fromSourcePortId: current,
      toSourcePortId: path.toSourcePortId,
    })
  return { ...path, pathSegments }
}

/** Number traces in receiver path order, then show the remaining scoped copper. */
function orientPlanTraces({
  paths,
  traceContacts,
}: {
  paths: readonly ResolvedPlanPath[]
  traceContacts: readonly TraceContacts[]
}): PlanTrace[] {
  const oriented = new Map<SourceTraceId, SourcePortId>()
  for (const { pathSegments } of paths)
    for (const segment of pathSegments)
      if (segment.kind === "trace" && !oriented.has(segment.sourceTraceId))
        oriented.set(segment.sourceTraceId, segment.fromSourcePortId)
  const traceContactsBySourceTraceId = new Map(
    traceContacts.map((contacts) => [contacts.sourceTraceId, contacts]),
  )
  const orderedSourceTraceIds = new Set([
    ...oriented.keys(),
    ...traceContactsBySourceTraceId.keys(),
  ])
  return [...orderedSourceTraceIds].flatMap(
    (sourceTraceId, index): PlanTrace[] => {
      const contacts = traceContactsBySourceTraceId.get(sourceTraceId)
      if (!contacts) return []
      const pathFromSourcePortId = oriented.get(sourceTraceId)
      const isOnReceiverPath = pathFromSourcePortId !== undefined
      if (pathFromSourcePortId === contacts.toSourcePortId)
        return [
          {
            ...contacts,
            fromSourcePortId: contacts.toSourcePortId,
            toSourcePortId: contacts.fromSourcePortId,
            index,
            isOnReceiverPath,
          },
        ]
      return [{ ...contacts, index, isOnReceiverPath }]
    },
  )
}

/** Reuse binding's node numbering and validation without changing the resulting plans. */
export function resolvePlanTopology({
  plan,
  paths,
  placedSourcePortIds,
}: {
  plan: TransientChannelSimulationPlan
  paths: readonly PlanPath[]
  placedSourcePortIds: ReadonlySet<SourcePortId>
}): PlanTopology {
  const {
    circuitJson: plannedCircuitJson,
    receiverPaths,
    traceContacts,
    modeling,
  } = plan.bindings
  const circuitJson = cloneCircuitJson(plannedCircuitJson)
  const db = cju(circuitJson)
  const channels = db.simulation_pcb_driver_receiver_channel.list()
  const groundSourcePortId = modeling.channelReference?.sourcePortId
  if (groundSourcePortId === undefined)
    throw new Error("Plan has no resolved reference port")
  const graphs = buildReceiverGraphs({
    db,
    circuit: circuitJson,
    traceContacts,
    channels,
    groundSourcePortId,
    modeling,
  })
  const { mapping: spiceNodeNamesBySourceContactId, node } = numberCircuitNodes(
    {
      db,
      graphs,
      groundSourcePortId,
    },
  )
  const resolved = paths.map((path) =>
    resolvePath({ path, graphs, spiceNodeNamesBySourceContactId }),
  )
  const visualTraces = orientPlanTraces({ paths: resolved, traceContacts })
  const activeSourcePortIds = new Set(
    [...paths, ...visualTraces].flatMap(
      ({ fromSourcePortId, toSourcePortId }) => [
        fromSourcePortId,
        toSourcePortId,
      ],
    ),
  )
  const topology: PlanTopology = {
    traces: visualTraces,
    spiceNodeNamesBySourceContactId,
    paths: resolved,
    overlays: buildTopologyOverlays({
      db,
      graphs,
      activeSourcePortIds,
      placedSourcePortIds,
      spiceNodeNamesBySourceContactId,
    }),
  }
  try {
    validateRoutedNodes({
      traceContacts,
      receiverPaths,
      graphs,
      channels,
      node,
      hasImplicitTraceContacts: false,
    })
  } catch (error) {
    if (!(error instanceof Diagnostic)) throw error
    return { ...topology, issue: error }
  }
  return topology
}

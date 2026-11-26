import type { SourcePortId, SourceTraceId } from "../board"
import type { DiagnosticSubject } from "../kernel"
import {
  buildConnectionGraph,
  type Connection,
  type ConnectionGraph,
  findConnectionPath,
} from "./connection-paths"
import { fail } from "./diagnostics"
import type { TraceContacts } from "./route-inputs"

/** The physical contacts of an extracted trace or series passive. */
export interface ChannelSegment {
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  sourceTraceId?: SourceTraceId
}

/** Trace contacts with their corresponding graph vertices. */
export type TraceConnection<VertexId> = Connection<VertexId, TraceContacts>

/** Project trace contacts onto graph vertices. */
export function connectTraces<VertexId>({
  traceContacts,
  getVertexId,
}: {
  traceContacts: readonly TraceContacts[]
  getVertexId: (sourcePortId: SourcePortId) => VertexId
}): TraceConnection<VertexId>[] {
  return traceContacts.map((contacts) => ({
    fromVertexId: getVertexId(contacts.fromSourcePortId),
    toVertexId: getVertexId(contacts.toSourcePortId),
    evidence: contacts,
  }))
}

/** Index trace contacts by source port. */
export function buildPhysicalTraceGraph(
  traceContacts: readonly TraceContacts[],
): ConnectionGraph<SourcePortId, TraceContacts> {
  return buildConnectionGraph(
    connectTraces({
      traceContacts,
      getVertexId: (sourcePortId) => sourcePortId,
    }),
  )
}

/** List the physical contacts that identify a closed path. */
function describeSegmentPath(segments: readonly ChannelSegment[]): string {
  return segments
    .map(
      ({ sourceTraceId, fromSourcePortId, toSourcePortId }) =>
        `${sourceTraceId ?? "series passive"} (${fromSourcePortId} to ${toSourcePortId})`,
    )
    .join(", ")
}

/** Attach the path’s trace and port IDs to its diagnostic. */
function getSegmentSubjects(
  segments: readonly ChannelSegment[],
): DiagnosticSubject[] {
  const recordIds = new Set(
    segments.flatMap(({ fromSourcePortId, toSourcePortId, sourceTraceId }) =>
      [fromSourcePortId, toSourcePortId, sourceTraceId].filter(
        (id) => id !== undefined,
      ),
    ),
  )
  return [...recordIds].map((id) => ({ kind: "record", id }))
}

/** Require a connection to be a bridge and report its concrete cycle otherwise. */
export function validateChannelBridge<VertexId>({
  graph,
  connection,
  physicalGraph,
}: {
  graph: ConnectionGraph<VertexId, ChannelSegment>
  physicalGraph: ConnectionGraph<SourcePortId, ChannelSegment>
  connection: Connection<VertexId, ChannelSegment>
}): void {
  const { fromVertexId, toVertexId, evidence } = connection
  const alternate = findConnectionPath({
    graph,
    fromVertexId,
    toVertexId,
    omitted: connection,
  })
  if (!alternate) return
  const { fromSourcePortId, toSourcePortId } = evidence
  const projectedPath = [...alternate.map((edge) => edge.evidence), evidence]
  if (evidence.sourceTraceId === undefined)
    fail(
      "channel_short",
      `Series passive contacts ${fromSourcePortId} and ${toSourcePortId} are bypassed`,
      { subjects: getSegmentSubjects(projectedPath) },
    )
  const physicalAlternate = findConnectionPath({
    graph: physicalGraph,
    fromVertexId: fromSourcePortId,
    toVertexId: toSourcePortId,
    omitted: physicalGraph
      .get(fromSourcePortId)
      ?.find((edge) => edge.evidence === evidence),
  })
  if (physicalAlternate) {
    const path = [...physicalAlternate.map((edge) => edge.evidence), evidence]
    fail(
      "channel_fanout",
      `Routed traces form a loop: ${describeSegmentPath(path)}`,
      { subjects: getSegmentSubjects(path) },
    )
  }
  fail(
    "channel_short",
    `Ideal connections close a path across routed traces: ${describeSegmentPath(projectedPath)}`,
    { subjects: getSegmentSubjects(projectedPath) },
  )
}

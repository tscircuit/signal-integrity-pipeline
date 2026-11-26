import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { SourceTrace } from "circuit-json"
import { findConnectedNetworks } from "circuit-json-to-connectivity-map"
import { type SourceNetId, type SourcePortId, sourcePinTies } from "../board"
import {
  buildConnectionGraph,
  type ConnectionGraph,
  findConnectionBridges,
  findConnectionPath,
} from "./connection-paths"
import { fail } from "./diagnostics"
import type { TraceContacts } from "./route-inputs"
import {
  buildPhysicalTraceGraph,
  connectTraces,
  type TraceConnection,
  validateChannelBridge,
} from "./trace-connections"

/** Source IDs which may resolve to a SPICE node name. */
export type SourceContactId = SourcePortId | SourceNetId

/** Each source port or net's representative under ideal connectivity. */
export type IdealGroups = ReadonlyMap<SourceContactId, SourceContactId>

/** Each vertex's representative under the specified connections. */
export type ConnectedGroups<VertexId> = ReadonlyMap<VertexId, VertexId>

/** Use the shared disjoint sets to give every group a representative. */
export function groupConnectedVertices<VertexId extends string>(
  connections: VertexId[][],
): ConnectedGroups<VertexId> {
  const networks = Object.values(
    findConnectedNetworks(connections),
  ) as VertexId[][]
  return new Map(
    networks.flatMap((members) =>
      members.map((id) => [id, members[0]] as const),
    ),
  )
}

/** Resolve a source contact to its group, retaining the contact when it is isolated. */
export function getIdealGroupId({
  groups,
  sourcePortId,
}: {
  groups: IdealGroups
  sourcePortId: SourcePortId
}): SourceContactId {
  return groups.get(sourcePortId) ?? sourcePortId
}

/** Report an extracted trace that has an ideal connection between its contacts. */
export function failShortedTrace({
  contacts,
  reason,
}: {
  contacts: TraceContacts
  reason: string
}): never {
  return fail(
    "channel_short",
    `${contacts.sourceTraceId}: ${contacts.fromSourcePortId} and ${contacts.toSourcePortId} ${reason}`,
    {
      subjects: [
        contacts.sourceTraceId,
        contacts.fromSourcePortId,
        contacts.toSourcePortId,
      ].map((id) => ({ kind: "record", id })),
    },
  )
}

/** Net identifiers spanning distinct extracted trace contacts. */
type SplitSourceNetIds = ReadonlySet<SourceNetId>

/** Identify the redundant net labels on a linear routed path. */
function splitNamedNets({
  db,
  ideal,
  explicitGroups,
  traceContacts,
}: {
  db: CircuitJsonUtilObjects
  ideal: readonly SourceTrace[]
  explicitGroups: IdealGroups
  traceContacts: readonly TraceContacts[]
}): SplitSourceNetIds {
  const traceConnectionsByIdealGroup = connectTraces({
    traceContacts,
    getVertexId: (sourcePortId) =>
      getIdealGroupId({ groups: explicitGroups, sourcePortId }),
  })
  const traceGraph = buildConnectionGraph(traceConnectionsByIdealGroup)
  const bridges = findConnectionBridges(traceGraph)
  const traceGroups = groupConnectedVertices(
    traceConnectionsByIdealGroup.map(({ fromVertexId, toVertexId }) => [
      fromVertexId,
      toVertexId,
    ]),
  )
  const physicalGraph = buildPhysicalTraceGraph(traceContacts)
  const netGroups = groupConnectedVertices(
    ideal
      .filter((trace) => !trace.connected_source_port_ids.length)
      .map((trace) => [...(trace.connected_source_net_ids ?? [])]),
  )
  const portsByNet = new Map<SourceNetId, Set<SourceContactId>>()
  for (const trace of ideal) {
    const [sourcePortId] = trace.connected_source_port_ids
    if (sourcePortId === undefined) continue
    const contact = getIdealGroupId({ groups: explicitGroups, sourcePortId })
    if (!traceGroups.has(contact)) continue
    for (const sourceNetId of trace.connected_source_net_ids ?? []) {
      const net = netGroups.get(sourceNetId) ?? sourceNetId
      const contacts = portsByNet.get(net) ?? new Set<SourceContactId>()
      contacts.add(contact)
      portsByNet.set(net, contacts)
    }
  }
  const splitNets = new Set<SourceNetId>()
  for (const [net, contacts] of portsByNet) {
    const namedTraceConnections = findConnectingTraces({
      traceGraph,
      traceGroups,
      contacts,
    })
    const connection = namedTraceConnections.find((edge) => !bridges.has(edge))
    if (connection)
      validateChannelBridge({ graph: traceGraph, connection, physicalGraph })
    if (!namedTraceConnections.length) continue
    const sourceNetIds = new Set([
      net,
      ...[...netGroups].flatMap(([id, group]) => {
        if (group === net) return [id]
        return []
      }),
    ])
    validateSplitNet({
      db,
      sourceNetIds,
      traceConnections: namedTraceConnections,
      explicitGroups,
    })
    for (const id of sourceNetIds) splitNets.add(id)
  }
  return splitNets
}

/** Find the traces between the net’s attachments. */
function findConnectingTraces({
  traceGraph,
  contacts,
  traceGroups,
}: {
  traceGroups: IdealGroups
  traceGraph: ConnectionGraph<SourceContactId, TraceContacts>
  contacts: ReadonlySet<SourceContactId>
}): TraceConnection<SourceContactId>[] {
  const contactsByTraceGroupId = new Map<SourceContactId, SourceContactId>()
  const traceConnections = new Set<TraceConnection<SourceContactId>>()
  for (const toVertexId of contacts) {
    const traceGroupId = traceGroups.get(toVertexId)!
    const fromVertexId = contactsByTraceGroupId.get(traceGroupId)
    if (fromVertexId === undefined) {
      contactsByTraceGroupId.set(traceGroupId, toVertexId)
      continue
    }
    for (const connection of findConnectionPath({
      graph: traceGraph,
      fromVertexId,
      toVertexId,
    })!)
      traceConnections.add(connection)
  }
  return [...traceConnections]
}

/** Require every binding of a split net to refer to the same linear routed path. */
function validateSplitNet({
  db,
  sourceNetIds,
  traceConnections,
  explicitGroups,
}: {
  db: CircuitJsonUtilObjects
  sourceNetIds: SplitSourceNetIds
  traceConnections: readonly TraceConnection<SourceContactId>[]
  explicitGroups: IdealGroups
}): void {
  const [{ evidence: contacts }] = traceConnections
  if (
    db.source_net
      .list()
      .some((net) => sourceNetIds.has(net.source_net_id) && net.is_ground)
  )
    failShortedTrace({ contacts, reason: "are bound to ground" })
  const degrees = new Map<SourceContactId, number>()
  const pairs = traceConnections.map(({ fromVertexId, toVertexId }) => [
    fromVertexId,
    toVertexId,
  ])
  for (const idealGroupId of pairs.flat())
    degrees.set(idealGroupId, (degrees.get(idealGroupId) ?? 0) + 1)
  const attached = db.source_trace
    .list()
    .filter((trace) =>
      trace.connected_source_net_ids?.some((id) => sourceNetIds.has(id)),
    )
  for (const trace of attached) {
    const nets = trace.connected_source_net_ids ?? []
    if (
      nets.some((id) => !sourceNetIds.has(id)) ||
      (trace.connected_source_port_ids.length > 0 && nets.length !== 1)
    )
      fail(
        "channel_net",
        `${contacts.sourceTraceId}: shared channel net has additional net bindings; select explicit endpoints`,
      )
  }
  if (
    Object.keys(findConnectedNetworks(pairs)).length !== 1 ||
    pairs.length !== degrees.size - 1 ||
    [...degrees.values()].some((degree) => degree > 2) ||
    attached.some((trace) =>
      trace.connected_source_port_ids.some(
        (id) => !degrees.has(explicitGroups.get(id) ?? id),
      ),
    )
  )
    fail(
      "channel_fanout",
      `${contacts.sourceTraceId}: shared channel net has additional ports; bind loads to an explicit endpoint`,
      {
        hint: "A shared channel net has additional ports. Bind loads to an explicit endpoint.",
      },
    )
}

/** The ideal partition and the named nets which now span multiple nodes. */
export interface IdealConnectivity {
  groups: IdealGroups
  splitNets: ReadonlySet<SourceNetId>
  wireConnections: SourceContactId[][]
}

/** Join source traces and internal pin ties, with routed copper removed. */
export function resolveIdealConnectivity({
  db,
  traceContacts,
}: {
  db: CircuitJsonUtilObjects
  traceContacts: readonly TraceContacts[]
}): IdealConnectivity {
  const extracted = new Set(
    traceContacts.map((contacts) => contacts.sourceTraceId),
  )
  const ideal = db.source_trace
    .list()
    .filter((trace) => !extracted.has(trace.source_trace_id))
  const pinTies = sourcePinTies(db)
  const explicitGroups = groupConnectedVertices([
    ...ideal.map((trace) => [...trace.connected_source_port_ids]),
    ...pinTies,
  ])
  const splitNets = splitNamedNets({ db, traceContacts, ideal, explicitGroups })
  const wireConnections = [
    ...ideal.map((trace) => [
      ...trace.connected_source_port_ids,
      ...(trace.connected_source_net_ids ?? []).filter(
        (id) => !splitNets.has(id),
      ),
    ]),
    ...pinTies,
  ]
  return {
    groups: groupConnectedVertices(wireConnections),
    splitNets,
    wireConnections,
  }
}

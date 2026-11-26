import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  endpointPorts,
  type ReceiverTracePath,
  type SimulationPcbDriverReceiverChannel,
  type SourcePortId,
  type SourceTraceId,
  selectPort,
} from "../board"
import type { DiagnosticSubject, Snapshot } from "../kernel"
import { findConnectionBridges } from "./connection-paths"
import { fail } from "./diagnostics"
import { listDifferentialContacts } from "./differential-contacts"
import {
  type ConnectedGroups,
  failShortedTrace,
  getIdealGroupId,
  groupConnectedVertices,
  type IdealConnectivity,
  type SourceContactId,
} from "./ideal-connectivity"
import {
  buildReceiverGraphs,
  findReceiverPath,
  type ReceiverGraphs,
} from "./receiver-paths"
import type { TraceContacts } from "./route-inputs"
import { connectTraces, validateChannelBridge } from "./trace-connections"
import type { CircuitNodes, SimulationModeling, SpiceNodeName } from "./types"

/** Board, trace contacts, and source selectors for SPICE node resolution. */
export interface CircuitNodesInput {
  circuit: CircuitJson
  receiverPaths: readonly ReceiverTracePath[]
  traceContacts?: readonly TraceContacts[]
  modeling: Snapshot<SimulationModeling>
}

/** Extract physical contacts from the traces in receiver paths. */
function extractTraceContacts({
  db,
  receiverPaths,
}: {
  db: CircuitJsonUtilObjects
  receiverPaths: readonly ReceiverTracePath[]
}): TraceContacts[] {
  const contactsBySourceTraceId = new Map<SourceTraceId, TraceContacts>()
  for (const { sourceTraceId, sourceTraceIds } of receiverPaths) {
    for (const pathSourceTraceId of sourceTraceIds ?? [sourceTraceId]) {
      if (contactsBySourceTraceId.has(pathSourceTraceId)) continue
      const ports =
        db.source_trace.get(pathSourceTraceId)?.connected_source_port_ids
      if (ports?.length !== 2)
        return fail(
          "channel_net",
          `${pathSourceTraceId}: expected two physical trace endpoints`,
        )
      const [fromSourcePortId, toSourcePortId] = ports
      contactsBySourceTraceId.set(pathSourceTraceId, {
        sourceTraceId: pathSourceTraceId,
        fromSourcePortId,
        toSourcePortId,
      })
    }
  }
  return [...contactsBySourceTraceId.values()]
}

/** Source-port IDs along a differential leg. */
type DifferentialLegSourcePortIds = SourcePortId[]

/** Include the physical contacts of each graph path on one differential leg. */
function getDifferentialLegPorts({
  sourcePortIds,
  graphs,
}: {
  sourcePortIds: SourcePortId[]
  graphs: ReceiverGraphs
}): DifferentialLegSourcePortIds {
  const [fromSourcePortId, ...receiverSourcePortIds] = sourcePortIds
  return [
    ...new Set([
      ...sourcePortIds,
      ...receiverSourcePortIds.flatMap((toSourcePortId) =>
        (
          findReceiverPath({
            graphs,
            fromSourcePortId,
            toSourcePortId,
            allowUnroutedTraces: true,
          }) ?? []
        ).flatMap(({ fromSourcePortId, toSourcePortId }) => [
          fromSourcePortId,
          toSourcePortId,
        ]),
      ),
    ]),
  ]
}

/** SPICE nodes grouped by connectivity through traces. */
type SpiceNodeGroups = ConnectedGroups<SpiceNodeName>

/** Attach physical evidence without changing the diagnostic's error message. */
function getRecordSubjects(recordIds: readonly string[]): DiagnosticSubject[] {
  return [...new Set(recordIds)].map((id) => ({ kind: "record", id }))
}

/** Validate the physical contacts and routed interiors of both differential legs. */
function validateDifferentialLegs({
  channels,
  node,
  legGroups,
  graphs,
}: {
  channels: readonly SimulationPcbDriverReceiverChannel[]
  node: CircuitNodes["node"]
  legGroups: SpiceNodeGroups
  graphs: ReceiverGraphs
}): void {
  const contacts = listDifferentialContacts(channels)
  for (const {
    name,
    positiveSourcePortIds,
    negativeSourcePortIds,
  } of contacts) {
    const positivePorts = getDifferentialLegPorts({
      sourcePortIds: positiveSourcePortIds,
      graphs,
    })
    const negativePorts = getDifferentialLegPorts({
      sourcePortIds: negativeSourcePortIds,
      graphs,
    })
    const groundedSourcePortId = [...positivePorts, ...negativePorts].find(
      (sourcePortId) => node(sourcePortId) === "0",
    )
    if (groundedSourcePortId !== undefined)
      fail(
        "channel_short",
        `${name}: contact ${groundedSourcePortId} is shorted to ground`,
        { subjects: getRecordSubjects([groundedSourcePortId]) },
      )
    const positiveGroups = new Map<SpiceNodeName, SourcePortId>()
    const positiveNodes = new Map<SpiceNodeName, SourcePortId>()
    for (const sourcePortId of positivePorts) {
      const spiceNode = node(sourcePortId)
      const spiceGroup = legGroups.get(spiceNode) ?? spiceNode
      if (!positiveNodes.has(spiceNode))
        positiveNodes.set(spiceNode, sourcePortId)
      if (!positiveGroups.has(spiceGroup))
        positiveGroups.set(spiceGroup, sourcePortId)
    }
    // Prefer an exact ideal contact so a driver short does not name a remote receiver.
    for (const negativeSourcePortId of negativePorts) {
      const positiveSourcePortId = positiveNodes.get(node(negativeSourcePortId))
      if (positiveSourcePortId !== undefined)
        fail(
          "channel_short",
          `${name}: negative contact ${negativeSourcePortId} is shorted to ${positiveSourcePortId}`,
          {
            subjects: getRecordSubjects([
              negativeSourcePortId,
              positiveSourcePortId,
            ]),
          },
        )
    }
    for (const negativeSourcePortId of negativePorts) {
      const spiceNode = node(negativeSourcePortId)
      const spiceGroup = legGroups.get(spiceNode) ?? spiceNode
      const positiveSourcePortId = positiveGroups.get(spiceGroup)
      if (positiveSourcePortId !== undefined)
        fail(
          "channel_short",
          `${name}: negative contact ${negativeSourcePortId} is shorted to ${positiveSourcePortId} through routed traces`,
          {
            subjects: getRecordSubjects([
              negativeSourcePortId,
              positiveSourcePortId,
            ]),
          },
        )
    }
  }
}

/** Create a source ID lookup over the resolved SPICE node names. */
function createCircuitNodeLookup({
  spiceNodeNamesBySourceContactId,
  splitNets,
}: {
  spiceNodeNamesBySourceContactId: CircuitNodes["mapping"]
  splitNets: IdealConnectivity["splitNets"]
}): CircuitNodes["node"] {
  /** Resolve one physical source port or named net. */
  return function node(sourceContactId: SourceContactId): SpiceNodeName {
    if (splitNets.has(sourceContactId))
      fail(
        "channel_net",
        `${sourceContactId}: extracted channel spans distinct endpoint nodes; select a physical port instead of the net`,
      )
    if (!Object.hasOwn(spiceNodeNamesBySourceContactId, sourceContactId))
      fail("simulation_reference", `Unknown source port/net ${sourceContactId}`)
    return spiceNodeNamesBySourceContactId[sourceContactId]
  }
}

/** Validate receiver paths separately from their constituent physical traces. */
function validateReceiverPaths({
  receiverPaths,
  node,
}: {
  receiverPaths: readonly ReceiverTracePath[]
  node: CircuitNodes["node"]
}): void {
  for (const {
    channelName,
    fromSourcePortId,
    toSourcePortId,
    sourceTraceId,
    sourceTraceIds,
  } of receiverPaths) {
    const fromSpiceNode = node(fromSourcePortId)
    const toSpiceNode = node(toSourcePortId)
    const traces = sourceTraceIds ?? [sourceTraceId]
    const path = traces.join(", ")
    if (fromSpiceNode === "0" || toSpiceNode === "0")
      fail(
        "channel_short",
        `${channelName}: endpoints ${fromSourcePortId} and ${toSourcePortId} include a ground contact on routed path ${path}`,
        {
          subjects: getRecordSubjects([
            fromSourcePortId,
            toSourcePortId,
            ...traces,
          ]),
        },
      )
    if (fromSpiceNode === toSpiceNode)
      fail(
        "channel_short",
        `${channelName}: endpoints ${fromSourcePortId} and ${toSourcePortId} share an ideal group across routed path ${path}`,
        {
          subjects: getRecordSubjects([
            fromSourcePortId,
            toSourcePortId,
            ...traces,
          ]),
        },
      )
  }
}

/** Check declared signal contacts even when a channel has no routed traces. */
function validateSingleEndedGround({
  channels,
  node,
}: {
  channels: readonly SimulationPcbDriverReceiverChannel[]
  node: CircuitNodes["node"]
}): void {
  for (const { name, driver, receivers } of channels) {
    if (!("source_port_id" in driver)) continue
    const groundedSourcePortId = [
      driver.source_port_id,
      ...receivers.flatMap(endpointPorts),
    ].find((sourcePortId) => node(sourcePortId) === "0")
    if (groundedSourcePortId !== undefined)
      fail(
        "channel_short",
        `${name}: contact ${groundedSourcePortId} is shorted to ground`,
        { subjects: getRecordSubjects([groundedSourcePortId]) },
      )
  }
}

/** Trace contacts and SPICE nodes shared by validation. */
interface ResolvedRoutedNodes {
  nodes: CircuitNodes
  traceContacts: readonly TraceContacts[]
}

/** Number one SPICE node per ideal group in source port order. */
export function numberCircuitNodes({
  db,
  graphs,
  groundSourcePortId,
}: {
  db: CircuitJsonUtilObjects
  graphs: ReceiverGraphs
  groundSourcePortId: SourcePortId
}): CircuitNodes {
  const { groups, splitNets } = graphs
  const spiceNodeNamesByIdealGroupId = new Map([
    [getIdealGroupId({ groups, sourcePortId: groundSourcePortId }), "0"],
  ])
  const sourceContactIds = new Set([
    ...db.source_port.list().map((port) => port.source_port_id),
    ...db.source_net.list().map((net) => net.source_net_id),
    ...groups.keys(),
  ])
  const spiceNodeNamesBySourceContactId = Object.freeze(
    Object.fromEntries(
      [...sourceContactIds].flatMap((sourceContactId) => {
        if (splitNets.has(sourceContactId)) return []
        const idealGroupId = groups.get(sourceContactId) ?? sourceContactId
        const spiceNodeName =
          spiceNodeNamesByIdealGroupId.get(idealGroupId) ??
          `n${spiceNodeNamesByIdealGroupId.size}`
        spiceNodeNamesByIdealGroupId.set(idealGroupId, spiceNodeName)
        return [[sourceContactId, spiceNodeName]]
      }),
    ),
  )
  return {
    node: createCircuitNodeLookup({
      spiceNodeNamesBySourceContactId,
      splitNets,
    }),
    groundSourcePortId,
    mapping: spiceNodeNamesBySourceContactId,
  }
}

/** Reject grounded traces and traces with shorted contacts. */
function validateTraceContacts({
  traceContacts,
  node,
  hasImplicitTraceContacts,
}: {
  traceContacts: readonly TraceContacts[]
  node: CircuitNodes["node"]
  hasImplicitTraceContacts: boolean
}): void {
  for (const contacts of traceContacts) {
    const fromSpiceNode = node(contacts.fromSourcePortId)
    const toSpiceNode = node(contacts.toSourcePortId)
    if (
      fromSpiceNode === toSpiceNode ||
      fromSpiceNode === "0" ||
      toSpiceNode === "0"
    ) {
      if (hasImplicitTraceContacts)
        fail(
          "channel_short",
          "Extracted endpoints are shorted by another ideal source trace or reference",
        )
      failShortedTrace({
        contacts,
        reason: "share an ideal group or are bound to ground",
      })
    }
  }
}

/** Resolve trace contacts once for node numbering and terminal validation. */
export function resolveRoutedNodes({
  circuit,
  receiverPaths,
  traceContacts: explicitTraceContacts,
  modeling,
}: CircuitNodesInput): ResolvedRoutedNodes {
  const db = cju([...circuit])
  const traceContacts =
    explicitTraceContacts || extractTraceContacts({ db, receiverPaths })
  const channels = db.simulation_pcb_driver_receiver_channel.list()
  const groundSourcePortId = selectPort({
    circuit,
    selector: modeling.channelReference,
  }).source_port_id
  const graphs = buildReceiverGraphs({
    db,
    circuit,
    traceContacts,
    channels,
    groundSourcePortId,
    modeling,
  })
  const nodes = numberCircuitNodes({ db, graphs, groundSourcePortId })
  validateRoutedNodes({
    traceContacts,
    receiverPaths,
    graphs,
    channels,
    node: nodes.node,
    hasImplicitTraceContacts: explicitTraceContacts === undefined,
  })
  return { nodes, traceContacts }
}

/** Validate trace contacts, receiver paths and passive boundaries. */
export function validateRoutedNodes({
  traceContacts,
  receiverPaths,
  graphs,
  channels,
  node,
  hasImplicitTraceContacts,
}: {
  traceContacts: readonly TraceContacts[]
  receiverPaths: readonly ReceiverTracePath[]
  graphs: ReceiverGraphs
  channels: readonly SimulationPcbDriverReceiverChannel[]
  node: CircuitNodes["node"]
  hasImplicitTraceContacts: boolean
}): void {
  validateTraceContacts({ traceContacts, node, hasImplicitTraceContacts })
  const connections = connectTraces({ traceContacts, getVertexId: node })
  const legGroups = groupConnectedVertices(
    connections.map(({ fromVertexId, toVertexId }) => [
      fromVertexId,
      toVertexId,
    ]),
  )
  validateDifferentialLegs({ channels, node, legGroups, graphs })
  validateReceiverPaths({ receiverPaths, node })
  validateSingleEndedGround({ channels, node })
  const bridges = findConnectionBridges(graphs.ideal)
  const connection = graphs.channelConnections.find(
    (edge) => !bridges.has(edge),
  )
  if (connection)
    validateChannelBridge({
      graph: graphs.ideal,
      physicalGraph: graphs.physical,
      connection,
    })
}

/** Resolve one SPICE node per ideal group. */
export function circuitNodes(input: CircuitNodesInput): CircuitNodes {
  return resolveRoutedNodes(input).nodes
}

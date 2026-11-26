import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type { PcbPort, PcbTrace, SourceTrace } from "circuit-json"
import {
  ConnectivityMap,
  findConnectedNetworks,
} from "circuit-json-to-connectivity-map"
import {
  type CircuitJson,
  crossesDifferentialLegs,
  endpointPorts,
  type PassiveBridge,
  passiveBridges,
  type SimulationPcbDriverReceiverChannel,
  type SourceNetId,
  type SourcePortId,
  sourceConnections,
  sourceNetMembers,
} from "../board"
import { fail } from "./diagnostics"
import {
  buildRoutedCopper,
  type CopperGraph,
  type CopperPointKey,
  type CopperTerminals,
} from "./topology-copper"

/** The source grouping and the series connections permitted for the channel simulation's rails. */
interface SignalTopology {
  connectivity: ConnectivityMap
  bridges: PassiveBridge[]
  rails: ReadonlySet<SourcePortId | SourceNetId>
}

/** Copper reachable from the declared endpoints on each side of a differential pair. */
interface DifferentialCopper {
  positive: ReadonlySet<CopperPointKey>
  negative: ReadonlySet<CopperPointKey>
}

/** Junctions physically reachable from a channel endpoint. */
type ReachableCopper = Set<CopperPointKey>

/** Look up the complete connected copper net for each junction. */
type CopperNets = Record<CopperPointKey, CopperPointKey[]>

/** Readable names for the ports of validated channel endpoints. */
type PortNames = Record<SourcePortId, string>

/** Source records in the routed copper graph. */
interface SelectedCopper {
  selected: ReadonlySet<SourcePortId | SourceNetId>
  traceIds: ReadonlySet<SourceTrace["source_trace_id"]>
  traces: readonly PcbTrace[]
  ports: readonly PcbPort[]
}

/** A driver starts a routed path with at most one physical edge. */
const MAX_DRIVER_NEIGHBORS = 1
/** A linear junction can have one incoming and one outgoing connection. */
const MAX_PATH_NEIGHBORS = 2

/** Extend the source nets through series passives for the channel simulation's rail set. */
export function signalTopology({
  circuit,
  rails,
}: {
  circuit: CircuitJson
  rails: ReadonlySet<SourcePortId | SourceNetId>
}): SignalTopology {
  const bridges = passiveBridges({ circuit, excluded: rails })
  const sourceConnectionGroups = sourceConnections(circuit)
  const connectivity = new ConnectivityMap(
    findConnectedNetworks([...sourceConnectionGroups, ...bridges]),
  )
  return { connectivity, bridges, rails }
}

/** Select ports and traces on the drivers' signal nets without admitting rail copper. */
function selectCopper({
  db,
  topology,
  driverReceiverChannels,
}: {
  db: CircuitJsonUtilObjects
  topology: SignalTopology
  driverReceiverChannels: readonly SimulationPcbDriverReceiverChannel[]
}): SelectedCopper {
  const { connectivity, rails } = topology
  const selected = new Set(
    driverReceiverChannels.flatMap(({ driver }) =>
      endpointPorts(driver).flatMap((memberId) => [
        ...sourceNetMembers({ connectivity, memberId }),
      ]),
    ),
  )
  const traceIds = new Set(
    db.source_trace
      .list()
      .filter((record) => {
        const ids = record.connected_source_port_ids.slice()
        if (record.connected_source_net_ids)
          ids.push(...record.connected_source_net_ids)
        return (
          ids.some((id) => selected.has(id)) && !ids.some((id) => rails.has(id))
        )
      })
      .map((trace) => trace.source_trace_id),
  )
  const traces = db.pcb_trace
    .list()
    .filter(
      ({ source_trace_id }) =>
        source_trace_id !== undefined && traceIds.has(source_trace_id),
    )
  const ports = db.pcb_port
    .list()
    .filter(
      (port) =>
        selected.has(port.source_port_id) && !rails.has(port.source_port_id),
    )
  return { selected, traceIds, traces, ports }
}

/** Index physical nets, including junctions with no neighbors. */
function copperNets(graph: CopperGraph): CopperNets {
  const networks = findConnectedNetworks(
    Object.entries(graph).map(([key, neighbors]) => [key, ...neighbors]),
  )
  return Object.fromEntries(
    Object.values(networks).flatMap((keys) => keys.map((key) => [key, keys])),
  )
}

/** Read every junction on the nets of the given terminals. */
function reachable({
  starts,
  nets,
}: {
  starts: CopperPointKey[]
  nets: CopperNets
}): ReachableCopper {
  return new Set(starts.flatMap((key) => nets[key]))
}

/** Find each differential leg before joining components across series passives. */
function differentialLegs({
  driverReceiverChannels,
  terminals,
  nets,
}: {
  driverReceiverChannels: readonly SimulationPcbDriverReceiverChannel[]
  terminals: CopperTerminals
  nets: CopperNets
}): DifferentialCopper[] {
  return driverReceiverChannels.flatMap(({ driver, receivers }) => {
    if ("source_port_id" in driver) return []
    const ends = [
      driver,
      ...receivers.filter((receiver) => "p_source_port_id" in receiver),
    ]
    const positive: CopperPointKey[] = []
    const negative: CopperPointKey[] = []
    for (const end of ends) {
      const p = terminals.get(end.p_source_port_id)
      if (p) positive.push(...p)
      const n = terminals.get(end.n_source_port_id)
      if (n) negative.push(...n)
    }
    return [
      {
        positive: reachable({ starts: positive, nets }),
        negative: reachable({ starts: negative, nets }),
      },
    ]
  })
}

/** Add series connections through passives, leaving cross-leg loads outside the routed path. */
function withPassiveBridges({
  bridges,
  differential,
  graph,
  terminals,
}: {
  bridges: PassiveBridge[]
  differential: DifferentialCopper[]
  graph: CopperGraph
  terminals: CopperTerminals
}): CopperGraph {
  const connected = Object.fromEntries(
    Object.entries(graph).map(([key, neighbors]) => [key, new Set(neighbors)]),
  )
  for (const [pinA, pinB] of bridges) {
    const first = terminals.get(pinA)
    const second = terminals.get(pinB)
    if (!first || !second) continue
    for (const a of first) {
      for (const b of second) {
        if (crossesDifferentialLegs({ from: a, to: b, differential })) continue
        if (a === b) continue
        connected[a].add(b)
        connected[b].add(a)
      }
    }
  }
  return connected
}

/** Describe the component-bound ports resolved as channel endpoints. */
function portNames(db: CircuitJsonUtilObjects): PortNames {
  const components = Object.fromEntries(
    db.source_component
      .list()
      .map((record) => [record.source_component_id, record.name]),
  )
  const names: PortNames = {}
  for (const port of db.source_port.list()) {
    if (port.source_component_id === undefined) continue
    names[port.source_port_id] =
      `${components[port.source_component_id]}.${port.name}`
  }
  return names
}

/** Check linearity for routed drivers and enforce receiver coverage under strict routing. */
function checkSignalRoutes({
  driverReceiverChannels,
  graph,
  terminals,
  routed,
  names,
  allowUnroutedTraces,
}: {
  driverReceiverChannels: readonly SimulationPcbDriverReceiverChannel[]
  graph: CopperGraph
  terminals: CopperTerminals
  routed: ReadonlySet<CopperPointKey>
  names: PortNames
  allowUnroutedTraces: boolean
}): void {
  const nets = copperNets(graph)
  for (const { name, driver, receivers } of driverReceiverChannels) {
    const drivers = endpointPorts(driver)
    const targets = receivers.map(endpointPorts)
    for (const [leg, port] of drivers.entries()) {
      const driverName = names[port]
      const starts = terminals.get(port)
      if (!starts) {
        if (!allowUnroutedTraces)
          fail(
            "channel_driver_terminal_missing",
            `Signal "${name}" is not routed from ${driverName}: the driver has no PCB terminal.`,
            { subjects: [{ kind: "record", id: port }] },
          )
        continue
      }
      const connected = reachable({ starts, nets })
      if (
        starts.some((key) => routed.has(key)) &&
        (starts.some((key) => graph[key].size > MAX_DRIVER_NEIGHBORS) ||
          [...connected].some((key) => graph[key].size > MAX_PATH_NEIGHBORS))
      )
        fail(
          "channel_fanout",
          `Signal "${name}" from ${driverName}: branched routes are not supported yet.`,
          { subjects: [{ kind: "record", id: port }] },
        )
      if (allowUnroutedTraces) continue
      for (const ports of targets) {
        const target = ports[leg]
        const targetName = names[target]
        const unrouted = `Signal "${name}" is not routed between ${driverName} and ${targetName}`
        const subjects = [port, target].map((id) => ({
          kind: "record" as const,
          id,
        }))
        const ends =
          terminals.get(target) ??
          fail(
            "channel_receiver_terminal_missing",
            `${unrouted}: the receiver has no PCB terminal on the signal net.`,
            { subjects },
          )
        if (!ends.some((key) => connected.has(key)))
          fail("channel_net", `${unrouted}.`, { subjects })
      }
    }
  }
}

/** Verify that routed copper forms a linear path from each driver to its receivers. */
export function validateSignalGraph({
  circuit,
  topology,
  driverReceiverChannels,
  allowUnroutedTraces,
}: {
  circuit: CircuitJson
  topology: SignalTopology
  driverReceiverChannels: readonly SimulationPcbDriverReceiverChannel[]
  allowUnroutedTraces: boolean
}): void {
  const db = cju([...circuit])
  const selected = selectCopper({ db, topology, driverReceiverChannels })
  const { graph, terminals, routed } = buildRoutedCopper({
    circuit,
    rails: topology.rails,
    ...selected,
  })
  const differential = differentialLegs({
    driverReceiverChannels,
    terminals,
    nets: copperNets(graph),
  })
  const connected = withPassiveBridges({
    bridges: topology.bridges,
    differential,
    graph,
    terminals,
  })
  checkSignalRoutes({
    driverReceiverChannels,
    graph: connected,
    terminals,
    routed,
    names: portNames(db),
    allowUnroutedTraces,
  })
}

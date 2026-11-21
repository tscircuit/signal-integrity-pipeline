import type { PcbPort, PcbTrace, SourceTrace } from "circuit-json"
import {
  ConnectivityMap,
  findConnectedNetworks,
} from "circuit-json-to-connectivity-map"
import {
  type CircuitJson,
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
  joinCopperPoints,
} from "./topology-copper"

/** The source grouping and the series connections permitted for this block's rails. */
interface SignalTopology {
  connectivity: ConnectivityMap
  bridges: PassiveBridge[]
  rails: ReadonlySet<SourcePortId | SourceNetId>
}

/** One driver's port per single-ended channel or differential leg. */
type EndpointPorts =
  | [single: SourcePortId]
  | [positive: SourcePortId, negative: SourcePortId]

/** Copper reachable from the declared endpoints on each side of a differential pair. */
interface DifferentialCopper {
  positive: ReadonlySet<CopperPointKey>
  negative: ReadonlySet<CopperPointKey>
}

/** Junctions physically reachable from a channel endpoint. */
type ReachableCopper = Set<CopperPointKey>

/** Look up the complete connected copper net for each junction. */
type CopperNets = Record<CopperPointKey, CopperPointKey[]>

/** Readable names for the ports of admitted channel endpoints. */
type PortNames = Record<SourcePortId, string>

/** Source records admitted to the routed copper graph. */
interface SelectedCopper {
  selected: ReadonlySet<SourcePortId | SourceNetId>
  traceIds: ReadonlySet<SourceTrace["source_trace_id"]>
  traces: PcbTrace[]
  ports: PcbPort[]
}

/** A driver starts a routed path with at most one physical edge. */
const MAX_DRIVER_NEIGHBORS = 1
/** A linear junction can have one incoming and one outgoing connection. */
const MAX_PATH_NEIGHBORS = 2

/** Extend the source nets through series passives for the block's rail set. */
export function signalTopology({
  circuit,
  rails,
}: {
  circuit: CircuitJson
  rails: ReadonlySet<SourcePortId | SourceNetId>
}): SignalTopology {
  const bridges = passiveBridges({ circuit, excluded: rails })
  const connectivity = new ConnectivityMap(
    findConnectedNetworks([...sourceConnections(circuit), ...bridges]),
  )
  return { connectivity, bridges, rails }
}

/** Keep endpoint ports in positive-to-negative order for differential channels. */
function endpointPorts(
  endpoint: SimulationPcbDriverReceiverChannel["driver"],
): EndpointPorts {
  if ("source_port_id" in endpoint) return [endpoint.source_port_id]
  return [endpoint.p_source_port_id, endpoint.n_source_port_id]
}

/** Select ports and traces on the drivers' signal nets without admitting rail copper. */
function selectCopper({
  circuit,
  topology,
  signals,
}: {
  circuit: CircuitJson
  topology: SignalTopology
  signals: readonly SimulationPcbDriverReceiverChannel[]
}): SelectedCopper {
  const { connectivity, rails } = topology
  const selected = new Set(
    signals.flatMap(({ driver }) =>
      endpointPorts(driver).flatMap((seed) => [
        ...sourceNetMembers({ connectivity, seed }),
      ]),
    ),
  )
  const traceIds = new Set(
    circuit
      .filter((record) => record.type === "source_trace")
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
  const traces = circuit
    .filter((record) => record.type === "pcb_trace")
    .filter(
      ({ source_trace_id }) =>
        source_trace_id !== undefined && traceIds.has(source_trace_id),
    )
  const ports = circuit
    .filter((record) => record.type === "pcb_port")
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
  signals,
  terminals,
  nets,
}: {
  signals: readonly SimulationPcbDriverReceiverChannel[]
  terminals: CopperTerminals
  nets: CopperNets
}): DifferentialCopper[] {
  return signals.flatMap(({ driver, receivers }) => {
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
function joinPassiveBridges({
  bridges,
  differential,
  graph,
  terminals,
}: {
  bridges: PassiveBridge[]
  differential: DifferentialCopper[]
  graph: CopperGraph
  terminals: CopperTerminals
}): void {
  for (const [pinA, pinB] of bridges) {
    const first = terminals.get(pinA)
    const second = terminals.get(pinB)
    if (!first || !second) continue
    for (const a of first) {
      for (const b of second) {
        if (
          differential.some(
            ({ positive, negative }) =>
              (positive.has(a) && negative.has(b)) ||
              (positive.has(b) && negative.has(a)),
          )
        )
          continue
        joinCopperPoints({ graph, a, b })
      }
    }
  }
}

/** Describe the component-bound ports admitted by channel endpoint resolution. */
function portNames(circuit: CircuitJson): PortNames {
  const components = Object.fromEntries(
    circuit
      .filter((record) => record.type === "source_component")
      .map((record) => [record.source_component_id, record.name]),
  )
  const names: PortNames = {}
  for (const port of circuit) {
    if (port.type !== "source_port" || port.source_component_id === undefined)
      continue
    names[port.source_port_id] =
      `${components[port.source_component_id]}.${port.name}`
  }
  return names
}

/** Check linearity for routed drivers and enforce receiver coverage under strict routing. */
function checkSignalRoutes({
  signals,
  graph,
  terminals,
  routed,
  names,
  allowUnroutedTraces,
}: {
  signals: readonly SimulationPcbDriverReceiverChannel[]
  graph: CopperGraph
  terminals: CopperTerminals
  routed: ReadonlySet<CopperPointKey>
  names: PortNames
  allowUnroutedTraces: boolean
}): void {
  const nets = copperNets(graph)
  for (const { name, driver, receivers } of signals) {
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
        )
      if (allowUnroutedTraces) continue
      for (const ports of targets) {
        const target = ports[leg]
        const targetName = names[target]
        const unrouted = `Signal "${name}" is not routed between ${driverName} and ${targetName}`
        const ends =
          terminals.get(target) ??
          fail(
            "channel_receiver_terminal_missing",
            `${unrouted}: the receiver has no PCB terminal on the signal net.`,
          )
        if (!ends.some((key) => connected.has(key)))
          fail("channel_net", `${unrouted}.`)
      }
    }
  }
}

/** Verify that routed copper forms a linear path from each driver to its receivers. */
export function validateSignalGraph({
  circuit,
  topology,
  signals,
  allowUnroutedTraces,
}: {
  circuit: CircuitJson
  topology: SignalTopology
  signals: readonly SimulationPcbDriverReceiverChannel[]
  allowUnroutedTraces: boolean
}): void {
  const selected = selectCopper({ circuit, topology, signals })
  const { graph, terminals, routed } = buildRoutedCopper({
    circuit,
    rails: topology.rails,
    ...selected,
  })
  const differential = differentialLegs({
    signals,
    terminals,
    nets: copperNets(graph),
  })
  joinPassiveBridges({
    bridges: topology.bridges,
    differential,
    graph,
    terminals,
  })
  checkSignalRoutes({
    signals,
    graph,
    terminals,
    routed,
    names: portNames(circuit),
    allowUnroutedTraces,
  })
}

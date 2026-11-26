import { cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  type ConnectivityMap,
  type CopperScope,
  channelCopperScope,
  endpointPorts,
  getSourcePortConnectivityMapFromCircuitJson,
  type SignalEndpointPortIds,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
} from "../board"
import {
  edgeDurationSeconds,
  type IbisSources,
  type InspectedPin,
  inspectPins,
  pinCapabilities,
} from "../buffers"
import { safeId } from "../kernel"
import { collectSignalRailIds, type SignalRailIds } from "../simulation"
import { signalTopology, validateSignalGraph } from "./topology"

/** Driver pins, named nets and edge times from validated channel endpoints. */
interface SignalIndex {
  driven: Map<SourcePortId, SimulationPcbDriverReceiverChannel>
  topology: Map<SourcePortId | SourceNetId, string>
  edgeTimesSeconds: number[]
}

interface SignalIndexOptions {
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  pins: Map<SourcePortId, InspectedPin>
  signalConnectivity: ConnectivityMap
}

/** Check that each differential pair belongs to one chip and follows the model's pin order. */
function checkDifferentialPairs({
  signal,
  pins,
}: {
  signal: SimulationPcbDriverReceiverChannel
  pins: Map<SourcePortId, InspectedPin>
}): void {
  const label = `Signal "${signal.name}"`
  for (const endpoint of [signal.driver, ...signal.receivers]) {
    const [p, n] = endpointPorts(endpoint).map((port) => pins.get(port)!)
    const pair = p.component.differentialPins.find(
      (pair) => pair.pin === p.pin && pair.invertedPin === n.pin,
    )
    if (p.model.source_component_id !== n.model.source_component_id) {
      throw new Error(
        `${label}: both differential legs must belong to the same chip.`,
      )
    }
    if (!pair) {
      const mismatch = `${label}: differential pin order disagrees with IBIS [Diff_pin];`
      throw new Error(`${mismatch} swap p and n or repair the model mapping.`)
    }
    // The vendor's model Polarity is already applied by the converter.
  }
}

/** Check the IBIS model and drive mode for one listed driver port. */
function validatedDriverPin({
  pins,
  port,
  signal,
}: {
  pins: SignalIndexOptions["pins"]
  port: SourcePortId
  signal: SimulationPcbDriverReceiverChannel
}): InspectedPin {
  const label = `Signal "${signal.name}"`
  const pin = pins.get(port)
  if (!pin)
    throw new Error(`${label} driver ${port} has no <simulation.ibismodel>.`)
  const capabilities = pinCapabilities(pin)
  if (!capabilities.drive) {
    throw new Error(
      `${label}: selected IBIS model "${pin.buffer.name}" does not support driving on ${port}.`,
    )
  }
  if (signal.driver_disabled && !capabilities.disable) {
    throw new Error(
      `${label}: ${port} model ${pin.buffer.name} has no disabled state; use pattern="0" or "1".`,
    )
  }
  return pin
}

/** Check each receiver's shape, IBIS role and matching driver connection. */
function validateReceivers({
  signal,
  pins,
  driverPorts,
  signalConnectivity,
}: Pick<SignalIndexOptions, "pins" | "signalConnectivity"> & {
  signal: SimulationPcbDriverReceiverChannel
  driverPorts: SignalEndpointPortIds
}): void {
  const label = `Signal "${signal.name}"`
  for (const receiver of signal.receivers) {
    if ("source_port_id" in receiver !== "source_port_id" in signal.driver) {
      throw new Error(
        `${signal.name}: driver and receiver must use the same endpoint shape`,
      )
    }
    for (const [index, port] of endpointPorts(receiver).entries()) {
      const pin = pins.get(port)
      if (!pin)
        throw new Error(
          `${label} receiver ${port} has no <simulation.ibismodel>.`,
        )
      if (!pinCapabilities(pin).receive) {
        throw new Error(
          `${label}: selected IBIS model "${pin.buffer.name}" does not support receiving on ${port}.`,
        )
      }
      const driverNet = sourceNetMembers({
        connectivity: signalConnectivity,
        memberId: driverPorts[index],
      })
      if (!driverNet.has(port)) {
        throw new Error(
          `Receiver ${port} is not connected to the copper of signal "${signal.name}".`,
        )
      }
    }
  }
}

/** Index checked driver pins and copper nets in declaration order. */
function indexDriverReceiverChannels({
  driverReceiverChannels,
  pins,
  signalConnectivity,
}: SignalIndexOptions): SignalIndex {
  const driven = new Map<SourcePortId, SimulationPcbDriverReceiverChannel>()
  const topology = new Map<SourcePortId | SourceNetId, string>()
  const edgeTimesSeconds: number[] = []
  for (const signal of driverReceiverChannels) {
    safeId({
      raw: signal.simulation_pcb_driver_receiver_channel_id,
      field: "simulationPcbDriverReceiverChannelId",
    })
    const driverPorts = endpointPorts(signal.driver)
    for (const port of driverPorts) {
      const pin = validatedDriverPin({ pins, port, signal })
      driven.set(port, signal)
      edgeTimesSeconds.push(edgeDurationSeconds(pin))
      for (const net of sourceNetMembers({
        connectivity: signalConnectivity,
        memberId: port,
      })) {
        const owner = topology.get(net)
        if (owner && owner !== signal.name) {
          throw new Error(
            `Signals "${owner}" and "${signal.name}" are on the same net; one signal per net.`,
          )
        }
        topology.set(net, signal.name)
      }
    }
    validateReceivers({ signal, pins, driverPorts, signalConnectivity })
    if ("p_source_port_id" in signal.driver)
      checkDifferentialPairs({ signal, pins })
  }
  return { driven, topology, edgeTimesSeconds }
}

/** Endpoints, connectivity and timing evidence from the initial pin inspection. */
export interface SignalPins extends SignalIndex {
  endpointIds: ReadonlySet<SourcePortId>
  connectivity: ConnectivityMap
  rails: SignalRailIds
  routedTopology: ReturnType<typeof signalTopology>
  reference: SourcePortId
}

/** Inspect the endpoints and trace their signal nets, rails and primary reference. */
export function inspectSignalPins({
  circuit,
  sources,
  driverReceiverChannels,
}: {
  circuit: CircuitJson
  sources: IbisSources
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
}): SignalPins {
  const endpointIds = new Set(
    driverReceiverChannels.flatMap((signal) =>
      [signal.driver, ...signal.receivers].flatMap(endpointPorts),
    ),
  )
  const selectedPins = inspectPins({ circuit, sources, ports: endpointIds })
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const rails = collectSignalRailIds({
    db: cju([...circuit]),
    connectivity,
    referenceSourcePortIds: [...selectedPins.values()].flatMap((pin) =>
      Object.values(pin.references),
    ),
  })
  const routedTopology = signalTopology({ circuit, rails })
  const index = indexDriverReceiverChannels({
    driverReceiverChannels,
    pins: selectedPins,
    signalConnectivity: routedTopology.connectivity,
  })
  const reference = selectedPins.get([...index.driven.keys()].sort()[0])!
    .references.pulldown
  return {
    ...index,
    endpointIds,
    connectivity,
    rails,
    routedTopology,
    reference,
  }
}

/** Copper scope, retained source IDs and the pins needed inside the scope. */
export interface ScopedSignalPins {
  copperScope: CopperScope
  retained: ReadonlySet<SourcePortId | SourceNetId>
  pins: Map<SourcePortId, InspectedPin>
}

/** Scope the copper and inspect retained pins in addition to the declared endpoints. */
export function scopeSignalPins({
  circuit,
  sources,
  nearbyGapMm,
  signalPins,
}: {
  circuit: CircuitJson
  sources: IbisSources
  nearbyGapMm: number
  signalPins: SignalPins
}): ScopedSignalPins {
  const { connectivity, topology, reference, rails, endpointIds } = signalPins
  const copperScope = channelCopperScope({
    circuit,
    connectivity,
    channelSourceIds: new Set(topology.keys()),
    referenceSourceIds: sourceNetMembers({ connectivity, memberId: reference }),
    railSourceIds: rails,
    distanceMm: nearbyGapMm,
  })
  const retained = new Set(copperScope.extractedSourceIds)
  const ports = new Set([...retained].filter((port) => !rails.has(port)))
  for (const port of endpointIds) ports.add(port)
  const pins = inspectPins({ circuit, sources, ports })
  return { copperScope, retained, pins }
}

/** Reject extra output drivers and check the selected signal graph. */
export function validateSignalPins({
  circuit,
  signalPins,
  pins,
  driverReceiverChannels,
  channelSimulation,
}: {
  circuit: CircuitJson
  signalPins: SignalPins
  pins: ScopedSignalPins["pins"]
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  channelSimulation: SimulationPcbTransientChannelSimulation
}): void {
  const { topology, driven, routedTopology } = signalPins
  for (const [port, name] of topology) {
    const pin = pins.get(port)
    if (!pin || driven.has(port) || pin.buffer.type !== "output") continue
    const drivers = `Signal "${name}" has two drivers: the listed driver and ${port} (IBIS model "${pin.buffer.name}").`
    throw new Error(`${drivers} Exactly one pin drives a signal.`)
  }
  validateSignalGraph({
    circuit,
    topology: routedTopology,
    driverReceiverChannels,
    allowUnroutedTraces: channelSimulation.allow_unrouted_traces,
  })
}

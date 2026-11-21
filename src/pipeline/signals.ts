/* eslint-disable local/max-file-lines -- Keep the preparation steps and their validation together. */
import {
  type CircuitJson,
  type ConnectivityMap,
  type CopperScope,
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  type SignalEndpoint,
  type SimulationBlockId,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
  stackupFromCircuitJson,
} from "../board"
import {
  edgeDurationSeconds,
  type IbisSources,
  type InspectedPin,
  inspectPins,
  pinCapabilities,
} from "../buffers"
import { Diagnostic, safeId } from "../kernel"
import { type RunControls, voltageSourceTerminals } from "../simulation"
import type { NumericalSettings } from "./modeling"
import {
  appendBlockControls,
  blockDurationSeconds,
  endpointPorts,
} from "./signal-controls"
import { addBlockSupplies } from "./supplies"
import { signalTopology, validateSignalGraph } from "./topology"

export { endpointPorts, probeEndpoints, signalBits } from "./signal-controls"

/** Maximum and default lateral search distance for routed admission, in millimetres. */
const MAX_COPPER_SCOPE_DISTANCE_MM = 32

/** Set the maximum transient step relative to the shortest bit. */
const STEPS_PER_BIT = 100

/** Set the maximum transient step relative to the fastest edge. */
const STEPS_PER_EDGE = 20

/** Ensure the maximum step is strictly shorter than the recording. */
const MIN_STEPS_PER_RECORDING = 2

/** Simulation records needed while lowering one selected block. */
const BLOCK_MODEL_RECORDS = [
  "simulation_ibis_model",
  "simulation_voltage_source",
  "simulation_spice_subcircuit",
]

/** Source component variants with a functional model type and component ID. */
type SourceComponent = Extract<
  CircuitJson[number],
  { type: "source_component" }
>

/** Named source ports and nets electrically connected to block reference or power rails. */
type RailIds = Set<SourcePortId | SourceNetId>

/** Ports and nets with a node supplied by routed copper, a buffer, or a voltage source. */
type LoadNodeIds = Set<SourcePortId | SourceNetId>

/** Driver pins, named nets and edge times from validated channel endpoints. */
interface SignalIndex {
  driven: Map<SourcePortId, SimulationPcbDriverReceiverChannel>
  topology: Map<SourcePortId | SourceNetId, string>
  edgeTimesSeconds: number[]
}

interface SignalIndexOptions {
  signals: SimulationPcbDriverReceiverChannel[]
  pins: Map<SourcePortId, InspectedPin>
  signalConnectivity: ConnectivityMap
}

/** The lowered circuit and controls for a single transient simulation block. */
export interface PreparedBlock {
  durationSeconds: number
  block: SimulationPcbTransientChannelSimulation
  signals: SimulationPcbDriverReceiverChannel[]
  circuit: CircuitJson
  controls: Record<string, RunControls>
  pins: Map<SourcePortId, InspectedPin>
  settings: NumericalSettings
}
/** Supported lanes and rejection messages from auditing the scoped copper. */
type RoutedLanes = {
  lanes: NumericalSettings["lanes"]
  rejections: string[]
}

/** Audit only selected/nearby routed nets; unsupported neighbours remain visible. */
export function routedLanes({
  circuit,
  scope,
  topology,
  driven,
  rails,
}: {
  circuit: CircuitJson
  scope: CopperScope
  topology: Map<SourcePortId | SourceNetId, string>
  driven: Set<SourcePortId>
  rails: Set<SourcePortId | SourceNetId>
}): RoutedLanes {
  const lanes: NumericalSettings["lanes"] = []
  const rejections: string[] = []
  const traces = circuit.filter((record) => record.type === "source_trace")
  const pcbTraces = circuit.filter((record) => record.type === "pcb_trace")
  traces.sort((a, b) => a.source_trace_id.localeCompare(b.source_trace_id))
  for (const trace of traces) {
    const ports = trace.connected_source_port_ids
    const pcb = pcbTraces.filter(
      (route) => route.source_trace_id === trace.source_trace_id,
    )
    if (!pcb.some((route) => scope.pcbTraceIds.includes(route.pcb_trace_id)))
      continue
    const members = [...ports, ...(trace.connected_source_net_ids ?? [])]
    if (members.some((port) => rails.has(port))) continue
    if (ports.length !== 2 || pcb.length !== 1) {
      const name =
        topology.get(ports[0]) ??
        trace.name ??
        trace.display_name ??
        trace.source_trace_id
      rejections.push(
        `Signal "${name}": branched routes are not supported yet.`,
      )
      continue
    }
    const ordered = [...ports].sort()
    if (driven.has(ordered[1]) && !driven.has(ordered[0])) ordered.reverse()
    const [from, to] = ordered
    const name = topology.get(from) || "passive"
    lanes.push({
      port: `${name}_${trace.source_trace_id}`,
      from: { sourcePortId: from },
      to: { sourcePortId: to },
      sourceTraceId: trace.source_trace_id,
    })
  }
  return { lanes, rejections }
}
/** Validate the shared block namespace before any independent block work. */
export function signalBlocks(
  circuitJson: CircuitJson,
): SimulationPcbTransientChannelSimulation[] {
  const blocks = circuitJson.filter(
    (r) => r.type === "simulation_pcb_transient_channel_simulation",
  )
  if (blocks.length > 1 && blocks.some((block) => !block.name)) {
    const element = "<simulation.pcbtransientchannelsimulation>"
    throw new Error(
      `This board has ${blocks.length} ${element} blocks; give each a name.`,
    )
  }
  const ids = new Set(
    blocks.map((block) => block.simulation_pcb_transient_channel_simulation_id),
  )
  if (ids.size !== blocks.length)
    throw new Error(
      "Duplicate simulation_pcb_transient_channel_simulation identifier",
    )
  for (const signal of circuitJson.filter(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )) {
    if (ids.has(signal.simulation_pcb_transient_channel_simulation_id)) continue
    throw new Error(`${signal.name}: unknown signal-integrity block`)
  }
  return blocks
}
/** Validate one block and lower its test intent to the private routed declarations. */
export function prepareBlockById({
  circuit,
  sources,
  blockId,
  distanceMm = MAX_COPPER_SCOPE_DISTANCE_MM,
}: {
  circuit: CircuitJson
  sources: IbisSources
  blockId: SimulationBlockId
  distanceMm?: number
}): PreparedBlock {
  if (
    !Number.isFinite(distanceMm) ||
    distanceMm <= 0 ||
    distanceMm > MAX_COPPER_SCOPE_DISTANCE_MM
  ) {
    throw new Error(
      `Copper scope distance must be in (0,${MAX_COPPER_SCOPE_DISTANCE_MM}] mm`,
    )
  }
  const blocks = signalBlocks(circuit)
  const matches = blocks.filter(
    (block) => block.simulation_pcb_transient_channel_simulation_id === blockId,
  )
  if (matches.length !== 1)
    throw new Error(`Expected exactly one signal-integrity block ${blockId}`)
  return prepareBlock({
    input: circuit,
    block: matches[0],
    sources,
    distanceMm,
  })
}
/** Selected IBIS model for a single-ended pin or one ordered differential leg. */
function selectedIbisModel({
  endpoint,
  index,
}: {
  endpoint: SignalEndpoint
  index: number
}): string | undefined {
  if ("source_port_id" in endpoint) return endpoint.ibis_model_name
  if (index === 0) return endpoint.p_ibis_model_name
  return endpoint.n_ibis_model_name
}

/** Unicode code point order, independent of locale and UTF-16 surrogate ordering. */
export function compareNames({ a, b }: { a: string; b: string }): number {
  const left = Array.from(a, (character) => character.codePointAt(0)!)
  const right = Array.from(b, (character) => character.codePointAt(0)!)
  const sharedLength = Math.min(left.length, right.length)
  for (let i = 0; i < sharedLength; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return left.length - right.length
}

/** Apply endpoint-specific IBIS model choices to the copied block records. */
function applyIbisModelOverrides({
  circuit,
  signals,
}: {
  circuit: CircuitJson
  signals: SimulationPcbDriverReceiverChannel[]
}): void {
  for (const model of circuit.filter(
    (r) => r.type === "simulation_ibis_model",
  )) {
    for (const signal of signals) {
      for (const endpoint of [signal.driver, ...signal.receivers]) {
        for (const [index, port] of endpointPorts(endpoint).entries()) {
          const selected = selectedIbisModel({ endpoint, index })
          if (!selected) continue
          for (const [pin, target] of Object.entries(
            model.ibis_pin_name_to_source_port_id,
          )) {
            if (target !== port) continue
            model.ibis_pin_name_to_model_name = {
              ...model.ibis_pin_name_to_model_name,
              [pin]: selected,
            }
          }
        }
      }
    }
  }
}

/** Collect all ports and nets tied to declared rails or to IBIS reference pins. */
function collectRailIds({
  circuit,
  connectivity,
  pins,
}: {
  circuit: CircuitJson
  connectivity: ConnectivityMap
  pins: Map<SourcePortId, InspectedPin>
}): RailIds {
  const railIds: RailIds = new Set()
  const sourceNets = circuit.filter((record) => record.type === "source_net")
  const supplyNetIds = sourceNets
    .filter((net) => net.is_ground || net.is_power)
    .map((net) => net.source_net_id)
  const pinReferences = [...pins.values()].flatMap((pin) =>
    Object.values(pin.references),
  )
  const explicit = circuit
    .filter((record) => record.type === "simulation_ibis_model")
    .flatMap((model) =>
      Object.values(
        model.ibis_pin_name_to_reference_source_port_ids ?? {},
      ).flatMap(Object.values),
    )
  for (const port of [...pinReferences, ...explicit, ...supplyNetIds]) {
    if (port === undefined || railIds.has(port)) continue
    for (const connected of sourceNetMembers({ connectivity, seed: port }))
      railIds.add(connected)
  }
  return railIds
}

/** A routed signal component can use a built-in passive or an explicit SPICE subcircuit. */
function hasSupportedComponentModel({
  component,
  circuit,
}: {
  component: SourceComponent | undefined
  circuit: CircuitJson
}): boolean {
  if (!component) return false
  if (
    ["simple_resistor", "simple_capacitor", "simple_inductor"].includes(
      component.ftype,
    )
  )
    return true
  return circuit.some((record) => {
    return (
      record.type === "simulation_spice_subcircuit" &&
      record.source_component_id === component.source_component_id
    )
  })
}

/** Check driver and receiver IBIS roles and index the selected copper nets. */
function indexBlockSignals({
  signals,
  pins,
  signalConnectivity,
}: SignalIndexOptions): SignalIndex {
  const driven = new Map<SourcePortId, SimulationPcbDriverReceiverChannel>()
  const topology = new Map<SourcePortId | SourceNetId, string>()
  const edgeTimesSeconds: number[] = []
  for (const signal of signals) {
    safeId({
      raw: signal.simulation_pcb_driver_receiver_channel_id,
      field: "simulationPcbDriverReceiverChannelId",
    })
    const drivers = endpointPorts(signal.driver)
    const label = `Signal "${signal.name}"`
    for (const port of drivers) {
      const pin = pins.get(port)
      if (!pin)
        throw new Error(
          `${label} driver ${port} has no <simulation.ibismodel>.`,
        )
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
      driven.set(port, signal)
      edgeTimesSeconds.push(edgeDurationSeconds(pin))
      for (const net of sourceNetMembers({
        connectivity: signalConnectivity,
        seed: port,
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
          seed: drivers[index],
        })
        if (!driverNet.has(port)) {
          throw new Error(
            `Receiver ${port} is not connected to the copper of signal "${signal.name}".`,
          )
        }
      }
    }
    if ("p_source_port_id" in signal.driver)
      checkDifferentialPairs({ signal, pins })
  }
  return { driven, topology, edgeTimesSeconds }
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

/** Keep only IBIS models and mapped ports needed by the retained pins. */
function pruneIbisModels({
  circuit,
  pins,
}: {
  circuit: CircuitJson
  pins: Map<SourcePortId, InspectedPin>
}): void {
  for (const model of circuit.filter(
    (record) => record.type === "simulation_ibis_model",
  )) {
    const used = [...pins.values()].filter((pin) => pin.model === model)
    if (!used.length) {
      circuit.splice(circuit.indexOf(model), 1)
      continue
    }
    const ports = new Set(
      used.flatMap((pin) => [pin.port, ...Object.values(pin.references)]),
    )
    const mappings = Object.entries(model.ibis_pin_name_to_source_port_id)
    model.ibis_pin_name_to_source_port_id = Object.fromEntries(
      mappings.filter(([, port]) => ports.has(port)),
    )
    model.ibis_pin_name_to_reference_source_port_ids = Object.fromEntries(
      used.map(({ pin, references }) => [
        pin,
        {
          pullup_reference_source_port_id: references.pullup,
          pulldown_reference_source_port_id: references.pulldown,
          power_clamp_reference_source_port_id: references.powerClamp,
          ground_clamp_reference_source_port_id: references.groundClamp,
          external_reference_source_port_id: references.external,
        },
      ]),
    )
  }
}

/** Find nodes that exist independently of the passive loads. */
function loadNodes({
  circuit,
  copperScope,
  pins,
}: {
  circuit: CircuitJson
  copperScope: CopperScope
  pins: PreparedBlock["pins"]
}): LoadNodeIds {
  const scoped = new Set(copperScope.pcbTraceIds)
  const railTraces = new Set(copperScope.railTraceIds)
  const routed = new Set(
    circuit
      .filter((record) => record.type === "pcb_trace")
      .filter(
        (trace) =>
          scoped.has(trace.pcb_trace_id) && !railTraces.has(trace.pcb_trace_id),
      )
      .map((trace) => trace.source_trace_id),
  )
  const traces = circuit.filter((record) => record.type === "source_trace")
  const ideal = getSourcePortConnectivityMapFromCircuitJson(
    traces.filter((trace) => !routed.has(trace.source_trace_id)),
  )
  const routeTerminals = traces
    .filter((trace) => routed.has(trace.source_trace_id))
    .flatMap((trace) => [
      ...trace.connected_source_port_ids,
      ...(trace.connected_source_net_ids ?? []),
    ])
  const bufferTerminals = [...pins.values()].flatMap((pin) => [
    pin.port,
    ...Object.values(pin.references),
  ])
  const sourceTerminals = circuit
    .filter((record) => record.type === "simulation_voltage_source")
    .flatMap(voltageSourceTerminals)
  const nodes: LoadNodeIds = new Set()
  for (const terminal of [
    ...routeTerminals,
    ...bufferTerminals,
    ...sourceTerminals,
  ]) {
    if (terminal === undefined) continue
    for (const id of sourceNetMembers({ connectivity: ideal, seed: terminal }))
      nodes.add(id)
  }
  return nodes
}

/** Require routed lanes for all drivers when unrouted traces are disallowed. */
function validateRoutedDrivers({
  block,
  signals,
  lanes,
}: {
  block: SimulationPcbTransientChannelSimulation
  signals: SimulationPcbDriverReceiverChannel[]
  lanes: NumericalSettings["lanes"]
}): void {
  if (block.allow_unrouted_traces) return
  for (const signal of signals) {
    for (const port of endpointPorts(signal.driver)) {
      if (
        lanes.some(
          (lane) =>
            lane.from.sourcePortId === port || lane.to.sourcePortId === port,
        )
      )
        continue
      throw new Error(`Signal "${signal.name}" is not routed from ${port}.`)
    }
  }
  if (!lanes.length)
    throw new Error(
      "At least one routed conductor is required for routed extraction",
    )
}

/** Independent block: model overrides, copper, pin states, references and stimuli. */
function prepareBlock({
  input,
  block,
  sources,
  distanceMm,
}: {
  input: CircuitJson
  block: SimulationPcbTransientChannelSimulation
  sources: IbisSources
  distanceMm: number
}): PreparedBlock {
  const id = safeId({
    raw: block.simulation_pcb_transient_channel_simulation_id,
    field: "simulationPcbTransientChannelSimulationId",
  })
  const channels = input.filter(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )
  const signals = channels.filter(
    (channel) => channel.simulation_pcb_transient_channel_simulation_id === id,
  )
  signals.sort((a, b) => compareNames({ a: a.name, b: b.name }))
  const names = new Set(signals.map((signal) => signal.name))
  const ids = new Set(
    signals.map((signal) => signal.simulation_pcb_driver_receiver_channel_id),
  )
  if (
    !signals.length ||
    names.size !== signals.length ||
    ids.size !== signals.length
  ) {
    throw new Error(`${block.name ?? id}: require distinct named signals`)
  }
  const durationSeconds = blockDurationSeconds({ block, signals })
  const records = input.filter((record) => {
    return (
      !record.type.startsWith("simulation_") ||
      BLOCK_MODEL_RECORDS.includes(record.type)
    )
  })
  const circuit = structuredClone([...records, block, ...signals])
  applyIbisModelOverrides({ circuit, signals })
  const endpointIds = new Set(
    signals.flatMap((signal) =>
      [signal.driver, ...signal.receivers].flatMap(endpointPorts),
    ),
  )
  const selectedPins = inspectPins({ circuit, sources, ports: endpointIds })
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const rails = collectRailIds({ circuit, connectivity, pins: selectedPins })
  const routedTopology = signalTopology({ circuit, rails })
  const { driven, topology, edgeTimesSeconds } = indexBlockSignals({
    signals,
    pins: selectedPins,
    signalConnectivity: routedTopology.connectivity,
  })
  const reference = selectedPins.get([...driven.keys()].sort()[0])!.references
    .pulldown
  const copperScope = channelCopperScope({
    circuit,
    connectivity,
    selected: new Set(topology.keys()),
    reference: sourceNetMembers({ connectivity, seed: reference }),
    rails,
    distanceMm,
  })
  const retained = new Set(copperScope.retainedSourceIds)
  const ports = new Set([...retained].filter((port) => !rails.has(port)))
  for (const port of endpointIds) ports.add(port)
  const pins = inspectPins({ circuit, sources, ports })
  for (const [port, name] of topology) {
    const pin = pins.get(port)
    if (!pin || driven.has(port) || pin.buffer.type !== "output") continue
    const drivers = `Signal "${name}" has two drivers: the listed driver and ${port} (IBIS model "${pin.buffer.name}").`
    throw new Error(`${drivers} Exactly one pin drives a signal.`)
  }
  validateSignalGraph({
    circuit,
    topology: routedTopology,
    signals,
    allowUnroutedTraces: block.allow_unrouted_traces,
  })
  const edgeTimeSeconds = Math.min(...edgeTimesSeconds)
  const rate = Math.max(...signals.map((signal) => signal.bit_rate_bps))
  const stepSeconds = Math.min(
    1 / rate / STEPS_PER_BIT,
    edgeTimeSeconds / STEPS_PER_EDGE,
    durationSeconds / MIN_STEPS_PER_RECORDING,
  )
  const circuitPorts = circuit.filter((record) => record.type === "source_port")
  const components = circuit.filter(
    (record) => record.type === "source_component",
  )
  for (const port of circuitPorts) {
    if (!topology.has(port.source_port_id) || pins.has(port.source_port_id))
      continue
    const component = components.find(
      (component) => component.source_component_id === port.source_component_id,
    )
    if (hasSupportedComponentModel({ component, circuit })) continue
    const label = component?.name ?? port.source_port_id
    throw new Error(
      `${label} is on the signal and has no supported SPICE or IBIS model.`,
    )
  }
  const scopeForLanes = {
    ...copperScope,
    pcbTraceIds: copperScope.selectedPcbTraceIds,
  }
  const { lanes, rejections } = routedLanes({
    circuit,
    scope: scopeForLanes,
    topology,
    driven: new Set(driven.keys()),
    rails,
  })
  if (rejections.length)
    throw Object.assign(
      new Diagnostic("pipeline", "channel_fanout", rejections[0]),
      { rejections, copperScope },
    )
  validateRoutedDrivers({ block, signals, lanes })
  // Stable physical endpoint identities order the matrix; route coordinates set coupling.
  lanes.sort((a, b) => a.from.sourcePortId!.localeCompare(b.from.sourcePortId!))
  pruneIbisModels({ circuit, pins })
  const stack = stackupFromCircuitJson(circuit)
  if (!stack.relativePermittivity) {
    throw new Error(
      "<simulation.pcbtransientchannelsimulation> needs explicit stackup dielectric constants.",
    )
  }
  const settings: NumericalSettings = {
    lanes,
    copperScope,
    channelReference: { sourcePortId: reference },
  }
  if (copperScope.pcbViaIds.length && !stack.viaPlatingMm) {
    throw new Error(
      "pcb_stackup must specify plated_hole_copper_thickness for routed vias",
    )
  }
  addBlockSupplies({
    circuit,
    connectivity,
    pins,
    retained,
    reference,
    settings,
  })
  const nodes = loadNodes({ circuit, copperScope, pins })
  const spiceModels = circuit.filter(
    (record) => record.type === "simulation_spice_subcircuit",
  )
  // Keep a retained load only when every modeled terminal already has an external connection.
  settings.passiveComponents = components.flatMap((component) => {
    if (!hasSupportedComponentModel({ component, circuit })) return []
    const sourceComponentId = component.source_component_id
    const model = spiceModels.find(
      (record) => record.source_component_id === sourceComponentId,
    )
    let terminals = circuitPorts
      .filter((port) => port.source_component_id === sourceComponentId)
      .map((port) => port.source_port_id)
    if (model) terminals = Object.values(model.spice_pin_to_source_port_map)
    if (!terminals.some((port) => retained.has(port) && !rails.has(port)))
      return []
    if (!terminals.every((port) => nodes.has(port))) return []
    return [{ sourceComponentId }]
  })
  const controls = appendBlockControls({
    circuit,
    id,
    block,
    signals,
    pins,
    driven,
    durationSeconds,
    rate,
    stepSeconds,
  })
  return {
    block,
    signals,
    circuit,
    controls: { [id]: controls },
    pins,
    settings,
    durationSeconds,
  }
}

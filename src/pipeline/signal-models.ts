import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type { PcbTrace } from "circuit-json"
import {
  type CircuitJson,
  type CopperScope,
  endpointPorts,
  getSourcePortConnectivityMapFromCircuitJson,
  hasBuiltInPassiveModel,
  type SignalEndpoint,
  type SimulationIbisModel,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
  stackupFromCircuitJson,
} from "../board"
import type { InspectedPin } from "../buffers"
import { snapshot } from "../kernel"
import { voltageSourceTerminals } from "../simulation"
import type { NumericalSettings } from "./modeling"
import type { ScopedSignalPins, SignalPins } from "./signal-pins"
import { withChannelSimulationSupplies } from "./supplies"

/** Ports and nets with a node supplied by routed copper, a buffer, or a voltage source. */
type LoadNodeIds = Set<SourcePortId | SourceNetId>

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

/** Map each IBIS record that needs a copy with selected endpoint models. */
type IbisModelOverrides = Map<CircuitJson[number], SimulationIbisModel>

/** Collect model choices and prepare replacements for the matching IBIS records. */
function ibisModelOverrides({
  db,
  driverReceiverChannels,
}: {
  db: CircuitJsonUtilObjects
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
}): IbisModelOverrides {
  const modelNameBySourcePortId = new Map<SourcePortId, string>()
  for (const signal of driverReceiverChannels) {
    for (const endpoint of [signal.driver, ...signal.receivers]) {
      for (const [index, sourcePortId] of endpointPorts(endpoint).entries()) {
        const modelName = selectedIbisModel({ endpoint, index })
        if (modelName === undefined) continue
        const previous = modelNameBySourcePortId.get(sourcePortId)
        if (previous !== undefined && previous !== modelName) {
          throw new Error(
            `Conflicting IBIS models for source port ${sourcePortId}: "${previous}" and "${modelName}".`,
          )
        }
        modelNameBySourcePortId.set(sourcePortId, modelName)
      }
    }
  }
  const models: IbisModelOverrides = new Map()
  for (const record of db.simulation_ibis_model.list()) {
    const overrides = Object.entries(
      record.ibis_pin_name_to_source_port_id,
    ).flatMap(([pin, sourcePortId]) => {
      const modelName = modelNameBySourcePortId.get(sourcePortId)
      if (modelName === undefined) return []
      return [[pin, modelName] as const]
    })
    if (!overrides.length) continue
    models.set(record, {
      ...record,
      ibis_pin_name_to_model_name: {
        ...record.ibis_pin_name_to_model_name,
        ...Object.fromEntries(overrides),
      },
    })
  }
  return models
}

/** Keep the board and part models, then apply the selected simulation's endpoint choices. */
export function channelSimulationCircuit({
  db,
  channelSimulation,
  driverReceiverChannels,
}: {
  db: CircuitJsonUtilObjects
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
}): CircuitJson {
  const models = ibisModelOverrides({ db, driverReceiverChannels })
  const partModelRecords = new Set<CircuitJson[number]>([
    ...db.simulation_ibis_model.list(),
    ...db.simulation_voltage_source.list(),
    ...db.simulation_spice_subcircuit.list(),
  ])
  const circuit = db
    .toArray()
    .filter(
      (record) =>
        !record.type.startsWith("simulation_") || partModelRecords.has(record),
    )
    .map((record) => models.get(record) ?? record)
  circuit.push(channelSimulation, ...driverReceiverChannels)
  return circuit
}

/** Require a supported model for every component on the signal nets. */
export function validateComponentModels({
  circuit,
  topology,
  pins,
}: {
  circuit: CircuitJson
  topology: ReadonlyMap<SourcePortId | SourceNetId, string>
  pins: ReadonlyMap<SourcePortId, InspectedPin>
}): void {
  const db = cju([...circuit])
  for (const port of db.source_port.list()) {
    if (!topology.has(port.source_port_id) || pins.has(port.source_port_id))
      continue
    const component = db.source_component.getWhere({
      source_component_id: port.source_component_id,
    })
    if (
      component &&
      (hasBuiltInPassiveModel(component) ||
        db.simulation_spice_subcircuit.getWhere({
          source_component_id: component.source_component_id,
        }))
    )
      continue
    const label = component?.name ?? port.source_port_id
    throw new Error(
      `${label} is on the signal and has no supported SPICE or IBIS model.`,
    )
  }
}

/** Pruned circuit and inspected pins pointing to its updated model records. */
interface PrunedIbisModels {
  circuit: CircuitJson
  pins: Map<SourcePortId, InspectedPin>
}

/** Copy one IBIS model with only its retained port and reference mappings. */
function prunedIbisModel({
  model,
  usedPins,
}: {
  model: InspectedPin["model"]
  usedPins: InspectedPin[]
}): InspectedPin["model"] {
  const ports = new Set(
    usedPins.flatMap((pin) => [pin.port, ...Object.values(pin.references)]),
  )
  const mappings = Object.entries(model.ibis_pin_name_to_source_port_id)
  return {
    ...model,
    ibis_pin_name_to_source_port_id: Object.fromEntries(
      mappings.filter(([, port]) => ports.has(port)),
    ),
    ibis_pin_name_to_reference_source_port_ids: Object.fromEntries(
      usedPins.map(({ pin, references }) => [
        pin,
        {
          pullup_reference_source_port_id: references.pullup,
          pulldown_reference_source_port_id: references.pulldown,
          power_clamp_reference_source_port_id: references.powerClamp,
          ground_clamp_reference_source_port_id: references.groundClamp,
          external_reference_source_port_id: references.external,
        },
      ]),
    ),
  }
}

/** Keep only IBIS models and mapped ports needed by the retained pins. */
export function withUsedIbisModels({
  circuit,
  pins,
}: {
  circuit: CircuitJson
  pins: Map<SourcePortId, InspectedPin>
}): PrunedIbisModels {
  const db = cju([...circuit])
  const models = new Map<
    CircuitJson[number],
    InspectedPin["model"] | undefined
  >()
  for (const model of db.simulation_ibis_model.list()) {
    const used = [...pins.values()].filter((pin) => pin.model === model)
    if (used.length === 0) models.set(model, undefined)
    else models.set(model, snapshot(prunedIbisModel({ model, usedPins: used })))
  }
  return {
    circuit: circuit.flatMap((record): CircuitJson => {
      if (!models.has(record)) return [record]
      const model = models.get(record)
      if (model === undefined) return []
      return [model]
    }),
    pins: new Map(
      Array.from(pins, ([id, pin]) => [
        id,
        { ...pin, model: models.get(pin.model)! },
      ]),
    ),
  }
}

/** Source trace IDs for scoped signal routes with separate terminal nodes. */
type RoutedLoadTraceIds = Set<PcbTrace["source_trace_id"]>

/** Identify scoped nonrail routes whose copper creates separate terminals. */
function routedLoadTraceIds({
  pcbTraces,
  copperScope,
}: {
  pcbTraces: readonly PcbTrace[]
  copperScope: CopperScope
}): RoutedLoadTraceIds {
  const scoped = new Set(copperScope.extractedPcbTraceIds)
  const railTraces = new Set(copperScope.nearbyRailPcbTraceIds)
  return new Set(
    pcbTraces
      .filter(
        (trace) =>
          scoped.has(trace.pcb_trace_id) && !railTraces.has(trace.pcb_trace_id),
      )
      .map((trace) => trace.source_trace_id),
  )
}

/** Find nodes that exist independently of the passive loads. */
function loadNodes({
  db,
  copperScope,
  pins,
}: {
  db: CircuitJsonUtilObjects
  copperScope: CopperScope
  pins: Map<SourcePortId, InspectedPin>
}): LoadNodeIds {
  const routed = routedLoadTraceIds({
    pcbTraces: db.pcb_trace.list(),
    copperScope,
  })
  const traces = db.source_trace.list()
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
  const sourceTerminals = db.simulation_voltage_source
    .list()
    .flatMap(voltageSourceTerminals)
  const nodes: LoadNodeIds = new Set()
  for (const terminal of [
    ...routeTerminals,
    ...bufferTerminals,
    ...sourceTerminals,
  ]) {
    if (terminal === undefined) continue
    for (const id of sourceNetMembers({
      connectivity: ideal,
      memberId: terminal,
    }))
      nodes.add(id)
  }
  return nodes
}

/** Keep a retained load only when every modeled terminal already has an external connection. */
function retainedPassiveComponents({
  circuit,
  copperScope,
  pins,
  retained,
  rails,
}: {
  circuit: CircuitJson
  copperScope: CopperScope
  pins: Map<SourcePortId, InspectedPin>
  retained: ReadonlySet<SourcePortId | SourceNetId>
  rails: ReadonlySet<SourcePortId | SourceNetId>
}): NonNullable<NumericalSettings["passiveComponents"]> {
  const db = cju([...circuit])
  const nodes = loadNodes({ db, copperScope, pins })
  return db.source_component.list().flatMap((component) => {
    const sourceComponentId = component.source_component_id
    const model = db.simulation_spice_subcircuit.getWhere({
      source_component_id: sourceComponentId,
    })
    if (!model && !hasBuiltInPassiveModel(component)) return []
    let terminals = db.source_port
      .list({ source_component_id: sourceComponentId })
      .map((port) => port.source_port_id)
    if (model) terminals = Object.values(model.spice_pin_to_source_port_map)
    if (!terminals.some((port) => retained.has(port) && !rails.has(port)))
      return []
    if (!terminals.every((port) => nodes.has(port))) return []
    return [{ sourceComponentId }]
  })
}

/** Numerical settings and the pruned circuit with its supplies. */
interface SuppliedSignalSettings {
  circuit: CircuitJson
  settings: NumericalSettings
}

/** Check the stackup and prepare numerical settings with supplies and retained loads. */
export function prepareSignalSettings({
  pruned,
  signalPins,
  scopedPins,
  traceContacts,
}: {
  pruned: PrunedIbisModels
  signalPins: Pick<SignalPins, "connectivity" | "rails" | "reference">
  scopedPins: Pick<ScopedSignalPins, "copperScope" | "retained">
  traceContacts: NumericalSettings["traceContacts"]
}): SuppliedSignalSettings {
  const { connectivity, rails, reference } = signalPins
  const { copperScope, retained } = scopedPins
  const stack = stackupFromCircuitJson(pruned.circuit)
  if (!stack.relativePermittivity) {
    throw new Error(
      "<simulation.pcbtransientchannelsimulation> needs explicit stackup dielectric constants.",
    )
  }
  if (copperScope.extractedPcbViaIds.length && !stack.viaPlatingMm) {
    throw new Error(
      "pcb_stackup must specify plated_hole_copper_thickness for routed vias",
    )
  }
  const settings: NumericalSettings = {
    traceContacts,
    copperScope,
    channelReference: { sourcePortId: reference },
  }
  const { circuit, supplies } = withChannelSimulationSupplies({
    ...pruned,
    connectivity,
    retained,
    reference,
  })
  if (supplies.length) settings.supplies = supplies
  settings.passiveComponents = retainedPassiveComponents({
    circuit,
    copperScope,
    pins: pruned.pins,
    retained,
    rails,
  })
  return { circuit, settings }
}

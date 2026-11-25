import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  endpointPorts,
  hasBuiltInPassiveModel,
  type SignalEndpoint,
  type SimulationIbisModel,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourceNetId,
  type SourcePortId,
} from "../board"
import type { InspectedPin } from "../buffers"
import { snapshot } from "../kernel"

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
export interface PrunedIbisModels {
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
      Array.from(pins, ([sourcePortId, pin]) => {
        const model = models.get(pin.model)
        if (!model)
          throw new Error(`${sourcePortId}: missing scoped IBIS model`)
        return [sourcePortId, { ...pin, model }]
      }),
    ),
  }
}

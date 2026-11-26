import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  hasBuiltInPassiveModel,
  type ReceiverTracePath,
  type SourcePortId,
} from "../board"
import type { Snapshot } from "../kernel"
import { fail } from "./diagnostics"
import { passiveSelectionComponents, placedSubcircuitPins } from "./netlist"
import type { TraceContacts } from "./route-inputs"
import type { PipelineIbisModel, SimulationModeling } from "./types"

/** The source contact IDs and the receiver paths or traces that require each contact. */
type RequiredContacts = ReadonlyMap<SourcePortId, string>

/** Keep the first receiver path or trace associated with each required physical contact. */
export function collectRequiredContacts({
  receiverPaths,
  traceContacts,
}: {
  receiverPaths: readonly ReceiverTracePath[]
  traceContacts: readonly TraceContacts[]
}): RequiredContacts {
  const endpoints = new Map<SourcePortId, string>()
  for (const {
    fromSourcePortId,
    toSourcePortId,
    channelName,
  } of receiverPaths) {
    if (!endpoints.has(fromSourcePortId))
      endpoints.set(fromSourcePortId, channelName)
    if (!endpoints.has(toSourcePortId))
      endpoints.set(toSourcePortId, channelName)
  }
  for (const {
    fromSourcePortId,
    toSourcePortId,
    sourceTraceId,
  } of traceContacts) {
    if (!endpoints.has(fromSourcePortId))
      endpoints.set(fromSourcePortId, sourceTraceId)
    if (!endpoints.has(toSourcePortId))
      endpoints.set(toSourcePortId, sourceTraceId)
  }
  return endpoints
}

/** Ports of the selected passive models. */
type PassiveModelSourcePortIds = ReadonlySet<SourcePortId>

/** Find the physical ports of the passive models actually selected for the deck. */
export function collectPassiveModelContacts({
  db,
  modeling,
}: {
  db: CircuitJsonUtilObjects
  modeling: Snapshot<SimulationModeling>
}): PassiveModelSourcePortIds {
  const components = db.source_component.list()
  const contacts = new Set<SourcePortId>()
  for (const selection of modeling.passiveComponents ?? []) {
    const matchingComponents = passiveSelectionComponents({
      components,
      selection,
    })
    if (matchingComponents.length !== 1) continue
    const [component] = matchingComponents
    const sourceComponentId = component.source_component_id
    const placed = db.simulation_spice_subcircuit.list({
      source_component_id: sourceComponentId,
    })
    if (placed.length === 1) {
      const [model] = placed
      const pins = placedSubcircuitPins(model.subcircuit_source)
      if (!pins) continue
      const terminals = pins.map(
        (pin) => model.spice_pin_to_source_port_map[pin],
      )
      if (terminals.some((sourcePortId) => !sourcePortId)) continue
      for (const sourcePortId of terminals) contacts.add(sourcePortId)
    } else if (!placed.length && hasBuiltInPassiveModel(component)) {
      const ports = db.source_port.list({
        source_component_id: sourceComponentId,
      })
      if (ports.length !== 2) continue
      for (const { source_port_id } of ports) contacts.add(source_port_id)
    }
  }
  return contacts
}

/** Every required contact needs its modeled passive terminal or one scoped IBIS run state. */
export function validateRoutedContacts({
  db,
  experimentName,
  requiredContactsBySourcePortId,
  scopedModels,
  runStateSourcePortIds,
  passiveModelSourcePortIds,
}: {
  db: CircuitJsonUtilObjects
  experimentName: string
  requiredContactsBySourcePortId: RequiredContacts
  scopedModels: readonly PipelineIbisModel[]
  runStateSourcePortIds: ReadonlySet<SourcePortId>
  passiveModelSourcePortIds: ReadonlySet<SourcePortId>
}): void {
  const modelsByPort = new Map<SourcePortId, number>()
  for (const model of scopedModels) {
    for (const sourcePortId of Object.values(
      model.ibis_pin_name_to_source_port_id,
    ))
      modelsByPort.set(sourcePortId, (modelsByPort.get(sourcePortId) ?? 0) + 1)
  }
  for (const [sourcePortId, label] of requiredContactsBySourcePortId) {
    const bindingCount = modelsByPort.get(sourcePortId) ?? 0
    if (bindingCount === 1 && runStateSourcePortIds.has(sourcePortId)) continue
    if (bindingCount === 0 && passiveModelSourcePortIds.has(sourcePortId))
      continue
    const sourcePort = db.source_port.get(sourcePortId)
    const component = db.source_component.getWhere({
      source_component_id: sourcePort?.source_component_id,
    })
    const requirement =
      "requires exactly one modeled physical pin and an explicit run state"
    let componentDetail = ""
    if (bindingCount === 0 && component)
      componentDetail = `; ${component.name} has no selected deck model for this contact`
    fail(
      "channel_model",
      `${experimentName} ${label}: endpoint ${sourcePortId} ${requirement}${componentDetail}`,
    )
  }
}

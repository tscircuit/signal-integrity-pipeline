import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type { PcbTrace } from "circuit-json"
import {
  type CircuitJson,
  type CopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  hasBuiltInPassiveModel,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
} from "../board"
import type { InspectedPin } from "../buffers"
import { voltageSourceTerminals } from "../simulation"
import type { NumericalSettings } from "./modeling"

type LoadNodeIds = Set<SourcePortId | SourceNetId>

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
      ...(trace.connected_source_net_ids || []),
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
export function retainedPassiveComponents({
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

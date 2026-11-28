import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import type { PcbCopperPour, PcbTrace, PcbVia } from "circuit-json"
import {
  type CircuitJson,
  channelCopperScope,
  endpointPorts,
  getSourcePortConnectivityMapFromCircuitJson,
  type SimulationPcbTransientChannelSimulation,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
} from "../../src/board"
import { validateNearbyGapMm } from "../../src/pipeline/signals"
import { signalTopology } from "../../src/pipeline/topology"
import { collectSignalRailIds } from "../../src/simulation"

export const copperCategories = ["selected", "near", "rail", "far"] as const
export type CopperCategory = (typeof copperCategories)[number]

/** Copper planes are represented by pcb_copper_pour records in Circuit JSON. */
type CopperRecord = PcbTrace | PcbVia | PcbCopperPour
type SourceId = SourceNetId | SourcePortId

/** One physical record and the scope evidence shown in the inspector. */
export interface InspectorCopper {
  id: string
  record: CopperRecord
  category: CopperCategory
  reason: string
}

/** Display categories and the simulated source nets that can use IBIS buffers. */
export interface InspectorCopperScope {
  copper: InspectorCopper[]
  retainedSourceIds: ReadonlySet<SourceId>
}

/** Source members explicitly attached to one trace. */
function traceMembers({
  db,
  sourceTraceId,
}: {
  db: CircuitJsonUtilObjects
  sourceTraceId?: PcbTrace["source_trace_id"]
}): SourceId[] {
  if (sourceTraceId === undefined) return []
  const trace = db.source_trace.get(sourceTraceId)
  if (!trace) return []
  return [
    ...trace.connected_source_port_ids,
    ...(trace.connected_source_net_ids ?? []),
  ]
}

/** Source association follows the via's own source trace before its parent PCB trace. */
function viaMembers({
  db,
  via,
}: {
  db: CircuitJsonUtilObjects
  via: PcbVia
}): SourceId[] {
  let sourceTraceId = via.source_trace_id
  if (sourceTraceId === undefined && via.pcb_trace_id !== undefined)
    sourceTraceId = db.pcb_trace.get(via.pcb_trace_id)?.source_trace_id
  const ids = traceMembers({ db, sourceTraceId })
  if (via.source_net_id !== undefined) ids.push(via.source_net_id)
  return ids
}

/** Return the explicitly mapped pulldown of the primary driver port. */
function primaryReference({
  db,
  driverPorts,
}: {
  db: CircuitJsonUtilObjects
  driverPorts: SourcePortId[]
}): SourcePortId | undefined {
  const primary = driverPorts.sort()[0]
  if (primary === undefined) return
  for (const model of db.simulation_ibis_model.list()) {
    for (const [pin, port] of Object.entries(
      model.ibis_pin_name_to_source_port_id,
    )) {
      if (port === primary)
        return model.ibis_pin_name_to_reference_source_port_ids?.[pin]
          ?.pulldown_reference_source_port_id
    }
  }
}

/** Preview the solver's copper scope using only declarations present in Circuit JSON. */
export function categorizeCopper({
  circuit,
  simulation,
  distanceMm,
}: {
  circuit: CircuitJson
  simulation: SimulationPcbTransientChannelSimulation
  distanceMm?: number
}): InspectorCopperScope {
  const db = cju([...circuit])
  const simulationId = simulation.simulation_pcb_transient_channel_simulation_id
  const channels = db.simulation_pcb_driver_receiver_channel.list({
    simulation_pcb_transient_channel_simulation_id: simulationId,
  })
  if (channels.length === 0)
    throw new Error("The selected simulation has no driver/receiver channels.")
  if (!db.pcb_board.getWhere({}))
    throw new Error("Circuit JSON needs a PCB board to scope its copper.")

  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const rails = collectSignalRailIds({
    db,
    connectivity,
    referenceSourcePortIds: [],
  })
  const topology = signalTopology({ circuit, rails })
  const channelBySource = new Map<SourceId, string>()
  for (const channel of channels) {
    for (const memberId of endpointPorts(channel.driver)) {
      for (const id of sourceNetMembers({
        connectivity: topology.connectivity,
        memberId,
      }))
        channelBySource.set(id, channel.name)
    }
  }
  const reference = primaryReference({
    db,
    driverPorts: channels.flatMap(({ driver }) => endpointPorts(driver)),
  })
  const referenceSourceIds = new Set<SourceId>()
  if (reference !== undefined) {
    for (const id of sourceNetMembers({ connectivity, memberId: reference }))
      referenceSourceIds.add(id)
  }
  const scope = channelCopperScope({
    circuit,
    connectivity,
    channelSourceIds: new Set(channelBySource.keys()),
    referenceSourceIds,
    railSourceIds: rails,
    distanceMm: validateNearbyGapMm(distanceMm),
  })
  const selectedTraces = new Set(scope.channelPcbTraceIds)
  const keptTraces = new Set(scope.extractedPcbTraceIds)
  const railTraces = new Set(scope.nearbyRailPcbTraceIds)
  const keptVias = new Set(scope.extractedPcbViaIds)
  const keptSources = new Set(scope.extractedSourceIds)
  const label = simulation.name ?? simulationId
  const far = `Outside the retained copper scope for ${label}.`
  const near = `Signal net kept by the copper scope for ${label}.`

  const copper = [
    ...db.pcb_trace.list().map((record): InspectorCopper => {
      const id = record.pcb_trace_id
      if (selectedTraces.has(id)) {
        const members = traceMembers({
          db,
          sourceTraceId: record.source_trace_id,
        })
        const channel = members.find((member) => channelBySource.has(member))!
        return {
          id,
          record,
          category: "selected",
          reason: `Channel ${channelBySource.get(channel)}.`,
        }
      }
      if (railTraces.has(id))
        return {
          id,
          record,
          category: "rail",
          reason: "Nearby rail trace kept as local copper.",
        }
      if (keptTraces.has(id))
        return { id, record, category: "near", reason: near }
      return { id, record, category: "far", reason: far }
    }),
    ...db.pcb_via.list().map((record): InspectorCopper => {
      const id = record.pcb_via_id
      const members = viaMembers({ db, via: record })
      const channel = members.find((member) => channelBySource.has(member))
      if (channel !== undefined)
        return {
          id,
          record,
          category: "selected",
          reason: `Channel ${channelBySource.get(channel)}.`,
        }
      if (!keptVias.has(id)) return { id, record, category: "far", reason: far }
      if (members.some((member) => referenceSourceIds.has(member)))
        return {
          id,
          record,
          category: "rail",
          reason: "Reference barrel kept across the board.",
        }
      if (members.some((member) => rails.has(member)))
        return {
          id,
          record,
          category: "rail",
          reason: "Nearby rail barrel kept as local copper.",
        }
      return { id, record, category: "near", reason: near }
    }),
    ...db.pcb_copper_pour.list().map((record): InspectorCopper => {
      const id = record.pcb_copper_pour_id
      const net = record.source_net_id
      if (net === undefined)
        return {
          id,
          record,
          category: "far",
          reason: "No source net association.",
        }
      const channel = channelBySource.get(net)
      if (channel !== undefined)
        return {
          id,
          record,
          category: "selected",
          reason: `Channel ${channel}.`,
        }
      if (rails.has(net))
        return {
          id,
          record,
          category: "rail",
          reason: "Rail pour available as a reference plane.",
        }
      if (keptSources.has(net))
        return { id, record, category: "near", reason: near }
      return { id, record, category: "far", reason: far }
    }),
  ]
  return { copper, retainedSourceIds: keptSources }
}

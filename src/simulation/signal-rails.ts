import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  type ConnectivityMap,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
} from "../board"
import { voltageSourceTerminals } from "./netlist"

/** Source ports and named nets electrically connected to rail terminals. */
export type SignalRailIds = Set<SourcePortId | SourceNetId>

/** Include flagged nets, explicit supplies, and all declared IBIS pin references. */
export function collectSignalRailIds({
  db,
  connectivity,
  referenceSourcePortIds,
}: {
  db: CircuitJsonUtilObjects
  connectivity: ConnectivityMap
  referenceSourcePortIds: readonly (SourcePortId | undefined)[]
}): SignalRailIds {
  const flaggedNets = db.source_net
    .list()
    .filter(({ is_ground, is_power }) => is_ground || is_power)
    .map(({ source_net_id }) => source_net_id)
  const ibisReferences = db.simulation_ibis_model
    .list()
    .flatMap((model) =>
      Object.values(
        model.ibis_pin_name_to_reference_source_port_ids ?? {},
      ).flatMap(Object.values),
    )
  const voltageTerminals = db.simulation_voltage_source
    .list()
    .flatMap(voltageSourceTerminals)
  const rails: SignalRailIds = new Set()
  for (const memberId of [
    ...flaggedNets,
    ...ibisReferences,
    ...voltageTerminals,
    ...referenceSourcePortIds,
  ]) {
    if (memberId === undefined || rails.has(memberId)) continue
    for (const id of sourceNetMembers({ connectivity, memberId })) rails.add(id)
  }
  return rails
}

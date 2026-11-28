import { cju } from "@tscircuit/circuit-json-util"
import { parseIbis } from "@tscircuit/ibis-to-spice"
import type { PcbTrace } from "circuit-json"
import {
  type CircuitJson,
  endpointPorts,
  getSourcePortConnectivityMapFromCircuitJson,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
  sourceNetMembers,
} from "../../../src/board"
import type { Snapshot } from "../../../src/kernel"
import { pinModel, readInlineIbis } from "../../channel-inspector/ibis-panel"

export type NetRole = "selected" | "near" | "excluded"

/** Workbench roles persist with the simulation and describe the net via its representative trace. */
export type SimulationNetRoles = Record<PcbTrace["pcb_trace_id"], NetRole>
type SimulationWithRoles = SimulationPcbTransientChannelSimulation & {
  workbench_net_roles?: SimulationNetRoles
}

/** Read explicit roles alongside the schema's implicit copper categories. */
export function netRoles(
  simulation?: SimulationPcbTransientChannelSimulation,
): Readonly<SimulationNetRoles> {
  return (
    (simulation as Snapshot<SimulationWithRoles> | undefined)
      ?.workbench_net_roles ?? {}
  )
}

/** Return connected source ports for a trace, including traces wired via a named net. */
export function tracePorts({
  circuit,
  trace,
}: {
  circuit: CircuitJson
  trace: PcbTrace
}): SourcePortId[] {
  const db = cju([...circuit])
  if (!trace.source_trace_id) return []
  const source = db.source_trace.get(trace.source_trace_id)
  if (!source) return []
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const initial = [
    ...source.connected_source_port_ids,
    ...(source.connected_source_net_ids ?? []),
  ]
  const members = new Set(
    initial.flatMap((memberId) => [
      ...sourceNetMembers({ connectivity, memberId }),
    ]),
  )
  return db.source_port
    .list()
    .filter(({ source_port_id }) => members.has(source_port_id))
    .map(({ source_port_id }) => source_port_id)
}

interface NetPins {
  drivers: SourcePortId[]
  receivers: SourcePortId[]
}

/** Identify embedded driver- and receiver-capable pins by their IBIS model types. */
function netPins({
  circuit,
  ports,
}: {
  circuit: CircuitJson
  ports: SourcePortId[]
}): NetPins {
  const drivers: SourcePortId[] = []
  const receivers: SourcePortId[] = []
  for (const model of cju([...circuit]).simulation_ibis_model.list()) {
    const source = readInlineIbis(model.ibis_model_asset.url)
    if (!source) continue
    const document = parseIbis(source)
    for (const [pin, port] of Object.entries(
      model.ibis_pin_name_to_source_port_id,
    )) {
      if (!ports.includes(port)) continue
      const name = pinModel({ model, document, pin })
      if (!name || !document.modelNames.includes(name)) continue
      const type = document.getBuffer(name).type
      if (type !== "input" && !type.startsWith("terminator")) drivers.push(port)
      if (type === "input" || type.startsWith("i/o")) receivers.push(port)
    }
  }
  return { drivers, receivers }
}

/** Reuse an existing channel or promote an unambiguous embedded single-ended net. */
function victimChannel({
  circuit,
  simulation,
  trace,
  ports,
}: {
  circuit: CircuitJson
  simulation: SimulationPcbTransientChannelSimulation
  trace: PcbTrace
  ports: SourcePortId[]
}): SimulationPcbDriverReceiverChannel {
  const db = cju([...circuit])
  const { drivers, receivers } = netPins({ circuit, ports })
  const driver = drivers[0]
  const loads = receivers.filter((port) => port !== driver)
  if (drivers.length !== 1 || loads.length === 0)
    throw new Error(
      "A victim needs one unambiguous embedded IBIS driver and at least one receiver.",
    )
  const signalName = db.source_port.get(driver)?.name ?? trace.pcb_trace_id
  const id = simulation.simulation_pcb_transient_channel_simulation_id
  return {
    type: "simulation_pcb_driver_receiver_channel",
    simulation_pcb_driver_receiver_channel_id: `${id}_${trace.pcb_trace_id}`,
    simulation_pcb_transient_channel_simulation_id: id,
    name: signalName,
    driver: { source_port_id: driver },
    receivers: loads.map((port) => ({ source_port_id: port })),
    pattern: "01",
    bit_rate_bps: simulation.bit_rate_bps,
    offset_ms: 0,
  }
}

/** Edit the persisted net role and the affected channel declarations immutably. */
export function editNetRole({
  circuit,
  simulation,
  trace,
  role,
}: {
  circuit: CircuitJson
  simulation: SimulationPcbTransientChannelSimulation
  trace: PcbTrace
  role: NetRole
}): CircuitJson {
  const ports = tracePorts({ circuit, trace })
  if (!ports.length)
    throw new Error("This copper has no connected source ports.")
  const id = simulation.simulation_pcb_transient_channel_simulation_id
  const channels = cju([
    ...circuit,
  ]).simulation_pcb_driver_receiver_channel.list({
    simulation_pcb_transient_channel_simulation_id: id,
  })
  const matching = channels.filter(({ driver }) =>
    endpointPorts(driver).some((port) => ports.includes(port)),
  )
  if (
    role !== "selected" &&
    matching.length > 0 &&
    channels.length === matching.length
  )
    throw new Error(
      "Keep at least one victim channel in the simulation. Promote another trace first.",
    )
  const next: CircuitJson = circuit.flatMap((record): CircuitJson => {
    if (
      record.type === "simulation_pcb_transient_channel_simulation" &&
      record.simulation_pcb_transient_channel_simulation_id === id
    ) {
      const updated: SimulationWithRoles = {
        ...record,
        workbench_net_roles: {
          ...netRoles(record),
          [trace.pcb_trace_id]: role,
        },
      }
      return [updated]
    }
    if (
      role !== "selected" &&
      record.type === "simulation_pcb_driver_receiver_channel" &&
      matching.some(
        ({ simulation_pcb_driver_receiver_channel_id }) =>
          simulation_pcb_driver_receiver_channel_id ===
          record.simulation_pcb_driver_receiver_channel_id,
      )
    )
      return []
    return [record]
  })
  if (role === "selected" && matching.length === 0)
    next.push(victimChannel({ circuit, simulation, trace, ports }))
  return next
}

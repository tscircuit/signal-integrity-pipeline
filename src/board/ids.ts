import type {
  PcbPort,
  PcbTrace,
  PcbVia,
  SimulationPcbTransientChannelSimulation,
  SourceNet,
  SourcePort,
  SourceTrace,
} from "circuit-json"

/** The identifier of a source port in Circuit JSON. */
export type SourcePortId = SourcePort["source_port_id"]

/** The identifier of a source net in Circuit JSON. */
export type SourceNetId = SourceNet["source_net_id"]

/** The identifier of a source trace in Circuit JSON. */
export type SourceTraceId = SourceTrace["source_trace_id"]

/** The identifier of a PCB port in Circuit JSON. */
export type PcbPortId = PcbPort["pcb_port_id"]

/** The identifier of a PCB trace in Circuit JSON. */
export type PcbTraceId = PcbTrace["pcb_trace_id"]

/** The identifier of a PCB via in Circuit JSON. */
export type PcbViaId = PcbVia["pcb_via_id"]

/** The identifier of a PCB transient channel simulation block in Circuit JSON. */
export type SimulationBlockId =
  SimulationPcbTransientChannelSimulation["simulation_pcb_transient_channel_simulation_id"]

/** One single-ended port, or the positive and negative ports in that order. */
export type SignalEndpointPortIds =
  | [SourcePortId]
  | [positive: SourcePortId, negative: SourcePortId]

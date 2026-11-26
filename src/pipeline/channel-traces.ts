import { cju } from "@tscircuit/circuit-json-util"
import type { PcbTrace, SourceTrace } from "circuit-json"
import type {
  CircuitJson,
  CopperScope,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
  SourceNetId,
  SourcePortId,
  SourceTraceId,
} from "../board"
import { endpointPorts } from "../board"
import { Diagnostic } from "../kernel"
import type { TraceContacts } from "../simulation"
import { compareNames } from "./signal-names"
import type { SignalPins } from "./signal-pins"

/** A trace rejected by the scoped copper audit and the reason it was rejected. */
type TraceRejection = { sourceTrace: SourceTrace; message: string }

/** Supported channel traces and rejections from auditing the scoped copper. */
type ChannelTraceAudit = {
  traceContacts: TraceContacts[]
  rejections: TraceRejection[]
}

/** Orient the selected trace from its driver when only one end is driven. */
function orientTraceContacts({
  trace,
  driven,
}: {
  trace: SourceTrace
  driven: ReadonlySet<SourcePortId>
}): TraceContacts {
  const ordered = trace.connected_source_port_ids.toSorted((a, b) =>
    compareNames({ a, b }),
  )
  if (driven.has(ordered[1]) && !driven.has(ordered[0])) ordered.reverse()
  const [fromSourcePortId, toSourcePortId] = ordered
  return {
    fromSourcePortId,
    toSourcePortId,
    sourceTraceId: trace.source_trace_id,
  }
}

/** Build channel traces and report unsupported routed traces on the channel. */
function auditChannelTraces({
  circuit,
  channelPcbTraceIds,
  topology,
  driven,
  rails,
}: {
  circuit: CircuitJson
  channelPcbTraceIds: Readonly<CopperScope["channelPcbTraceIds"]>
  topology: Map<SourcePortId | SourceNetId, string>
  driven: Set<SourcePortId>
  rails: Set<SourcePortId | SourceNetId>
}): ChannelTraceAudit {
  const traceContacts: TraceContacts[] = []
  const rejections: TraceRejection[] = []
  const db = cju([...circuit])
  const selectedPcbTraceIds = new Set(channelPcbTraceIds)
  const pcbTracesBySourceTraceId = new Map<SourceTraceId, PcbTrace[]>()
  for (const pcbTrace of db.pcb_trace.list()) {
    const { source_trace_id: sourceTraceId } = pcbTrace
    if (sourceTraceId === undefined) continue
    const pcbTraces = pcbTracesBySourceTraceId.get(sourceTraceId)
    if (pcbTraces) pcbTraces.push(pcbTrace)
    else pcbTracesBySourceTraceId.set(sourceTraceId, [pcbTrace])
  }
  const sourceTraces = db.source_trace
    .list()
    .toSorted((a, b) =>
      compareNames({ a: a.source_trace_id, b: b.source_trace_id }),
    )
  for (const trace of sourceTraces) {
    const sourcePortIds = trace.connected_source_port_ids
    const pcbTraces = pcbTracesBySourceTraceId.get(trace.source_trace_id)
    if (
      !pcbTraces?.some(({ pcb_trace_id }) =>
        selectedPcbTraceIds.has(pcb_trace_id),
      )
    )
      continue
    const members = [
      ...sourcePortIds,
      ...(trace.connected_source_net_ids ?? []),
    ]
    if (members.some((port) => rails.has(port))) continue
    if (sourcePortIds.length !== 2 || pcbTraces.length !== 1) {
      const name =
        topology.get(sourcePortIds[0]) ??
        trace.name ??
        trace.display_name ??
        "unnamed"
      rejections.push({
        sourceTrace: trace,
        message: `Signal "${name}": branched routes are not supported yet.`,
      })
      continue
    }
    traceContacts.push(orientTraceContacts({ trace, driven }))
  }
  return { traceContacts, rejections }
}

/** Require routed traces for all drivers when unrouted traces are disallowed. */
function validateRoutedDrivers({
  channelSimulation,
  driverReceiverChannels,
  traceContacts,
}: {
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  traceContacts: TraceContacts[]
}): void {
  if (channelSimulation.allow_unrouted_traces) return
  for (const signal of driverReceiverChannels) {
    for (const port of endpointPorts(signal.driver)) {
      if (
        traceContacts.some(
          ({ fromSourcePortId, toSourcePortId }) =>
            fromSourcePortId === port || toSourcePortId === port,
        )
      )
        continue
      throw new Error(`Signal "${signal.name}" is not routed from ${port}.`)
    }
  }
  if (!traceContacts.length)
    throw new Error(
      "At least one routed conductor is required for routed extraction",
    )
}

/** Validate scoped traces and order them by stable physical endpoint identity. */
export function prepareTraceContacts({
  circuit,
  copperScope,
  channelSimulation,
  driverReceiverChannels,
  signalPins,
}: {
  circuit: CircuitJson
  copperScope: CopperScope
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  signalPins: Pick<SignalPins, "topology" | "driven" | "rails">
}): TraceContacts[] {
  const { topology, driven, rails } = signalPins
  const { traceContacts, rejections } = auditChannelTraces({
    circuit,
    channelPcbTraceIds: copperScope.channelPcbTraceIds,
    topology,
    driven: new Set(driven.keys()),
    rails,
  })
  const rejection = rejections[0]
  if (rejection) {
    const { source_trace_id, connected_source_port_ids } = rejection.sourceTrace
    throw Object.assign(
      new Diagnostic("pipeline", "channel_fanout", rejection.message, {
        subjects: [source_trace_id, ...connected_source_port_ids].map((id) => ({
          kind: "record",
          id,
        })),
      }),
      { rejections: rejections.map(({ message }) => message), copperScope },
    )
  }
  validateRoutedDrivers({
    channelSimulation,
    driverReceiverChannels,
    traceContacts,
  })
  return traceContacts.toSorted((a, b) =>
    compareNames({ a: a.fromSourcePortId, b: b.fromSourcePortId }),
  )
}

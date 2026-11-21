import type {
  SignalEndpoint,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
} from "circuit-json"
import type { SourcePortId } from "./ids"

export type {
  SignalEndpoint,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
}

/** Check whether a valid channel pattern repeats a single bit. */
function isConstantBitPattern(pattern: string): boolean {
  const first = pattern[0]
  for (const bit of pattern) {
    if (bit !== first) return false
  }
  return true
}

/** Returns whether a channel has a disabled driver or a constant literal bit pattern. */
export function isQuiet(channel: SimulationPcbDriverReceiverChannel): boolean {
  return (
    channel.driver_disabled === true || isConstantBitPattern(channel.pattern)
  )
}

/** The ordered physical port IDs of a signal endpoint. */
type SignalEndpointPortIds = SourcePortId[]

/** The physical ports of a signal endpoint, excluding optional IBIS model names. */
export function signalEndpointPortIds(
  endpoint: SignalEndpoint,
): SignalEndpointPortIds {
  if ("source_port_id" in endpoint) return [endpoint.source_port_id]
  return [endpoint.p_source_port_id, endpoint.n_source_port_id]
}

import type {
  SignalEndpoint,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
} from "circuit-json"
import type { SignalEndpointPortIds } from "./ids"

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

/** Pattern and timing shared by selected channels and aggressors. */
export type DriverPattern = Pick<
  SimulationPcbDriverReceiverChannel,
  "name" | "pattern" | "bit_rate_bps" | "offset_ms" | "seed" | "driver_disabled"
>

/** Returns whether a channel has a disabled driver or a constant literal bit pattern. */
export function isQuiet(channel: DriverPattern): boolean {
  return (
    channel.driver_disabled === true || isConstantBitPattern(channel.pattern)
  )
}

/** Ordered physical ports. The sign of a differential signal is P minus N. */
export function endpointPorts(endpoint: SignalEndpoint): SignalEndpointPortIds {
  if ("source_port_id" in endpoint) return [endpoint.source_port_id]
  return [endpoint.p_source_port_id, endpoint.n_source_port_id]
}

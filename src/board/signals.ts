import type {
  SignalEndpoint,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
} from "circuit-json"

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

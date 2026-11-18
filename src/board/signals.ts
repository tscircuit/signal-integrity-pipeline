export type { SimulationPcbDriverReceiverChannel, SimulationPcbTransientChannelSimulation, SignalEndpoint } from 'circuit-json'
import type { SignalEndpoint, SimulationPcbDriverReceiverChannel } from 'circuit-json'

/** Constant literal patterns and disabled drivers record quiet-channel idle voltages. */
export function isQuiet(signal: SimulationPcbDriverReceiverChannel): boolean {
  return !!signal.driver_disabled || /^(?:0+|1+)$/.test(signal.pattern)
}

/** The physical ports of a signal endpoint, excluding optional IBIS model names. */
export function signalEndpointPortIds(endpoint: SignalEndpoint): string[] {
  if ('source_port_id' in endpoint) return [endpoint.source_port_id]
  return [endpoint.p_source_port_id, endpoint.n_source_port_id]
}

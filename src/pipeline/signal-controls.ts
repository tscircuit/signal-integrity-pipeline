import {
  type CircuitJson,
  isQuiet,
  type SignalEndpoint,
  type SignalEndpointPortIds,
  type SimulationBlockId,
  type SimulationExperiment,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
} from "../board"
import { type InspectedPin, pinCapabilities } from "../buffers"
import { MAX_STIMULUS_BITS, type RunControls } from "../simulation"
import { defaultDurationSeconds, prbsPatterns } from "./timing"

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000

/** Round bit intervals with the same floating-point tolerance as the IBIS converter. */
const INTERVAL_ROUNDING_ULPS = 8

/** Solver error tolerances for the routed transient (relative, current in amps, voltage in volts). */
const SPICE_OPTIONS: NonNullable<SimulationExperiment["spice_options"]> = {
  reltol: 1e-5,
  abstol: 1e-12,
  vntol: 1e-8,
}

interface ControlOptions {
  circuit: CircuitJson
  id: SimulationBlockId
  block: SimulationPcbTransientChannelSimulation
  signals: SimulationPcbDriverReceiverChannel[]
  pins: Map<SourcePortId, InspectedPin>
  driven: Map<SourcePortId, SimulationPcbDriverReceiverChannel>
  durationSeconds: number
  rate: number
  stepSeconds: number
}

/** Ordered physical ports. The sign of a differential signal is P minus N. */
export function endpointPorts(endpoint: SignalEndpoint): SignalEndpointPortIds {
  if ("source_port_id" in endpoint) return [endpoint.source_port_id]
  return [endpoint.p_source_port_id, endpoint.n_source_port_id]
}

/** Choose the capture duration in seconds and check coverage of enabled stimuli. */
export function blockDurationSeconds({
  block,
  signals,
}: {
  block: SimulationPcbTransientChannelSimulation
  signals: SimulationPcbDriverReceiverChannel[]
}): number {
  let durationSeconds: number
  if (block.duration_ms === undefined)
    durationSeconds = defaultDurationSeconds(signals)
  else durationSeconds = block.duration_ms / MILLISECONDS_PER_SECOND
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Recording duration must be finite and positive.")
  }
  for (const signal of signals) {
    if (signal.driver_disabled) continue
    const startSeconds = signal.offset_ms / MILLISECONDS_PER_SECOND
    if (!Number.isFinite(startSeconds) || startSeconds < 0)
      throw new Error(`${signal.name}: invalid stimulus offset.`)
    // A constant driver holds its level from t=0.
    if (isQuiet(signal)) continue
    if (startSeconds >= durationSeconds)
      throw new Error(
        `${signal.name}: stimulus starts after the experiment ends.`,
      )
  }
  return durationSeconds
}

/** Include a quiet driver as the last probe after the receivers. */
export function probeEndpoints(
  signal: SimulationPcbDriverReceiverChannel,
): SignalEndpoint[] {
  if (isQuiet(signal)) return [...signal.receivers, signal.driver]
  return signal.receivers
}

/** Check for a nonempty string of literal binary digits. */
function isBitPattern(pattern: string): boolean {
  if (pattern.length === 0) return false
  for (const bit of pattern) {
    if (bit !== "0" && bit !== "1") return false
  }
  return true
}

/** Generate only the part of the seeded PRBS needed for the requested recording. */
export function signalBits({
  signal,
  durationSeconds,
}: {
  signal: SimulationPcbDriverReceiverChannel
  durationSeconds: number
}): string {
  const prbs = prbsPatterns.get(signal.pattern)
  const { seed, pattern } = signal
  let mask = 0
  if (prbs) {
    mask = 2 ** prbs.width - 1
    if (
      seed === undefined ||
      !Number.isInteger(seed) ||
      seed < 1 ||
      seed > mask
    ) {
      throw new Error(
        `Signal "${signal.name}": ${pattern} seed must be an integer in 1..${mask}.`,
      )
    }
  }

  if (!prbs && pattern !== "clock" && !isBitPattern(pattern)) {
    const validPatterns =
      "a pseudo-random binary sequence (PRBS), clock, or a literal bit string"
    throw new Error(`${signal.name}: pattern must be ${validPatterns}`)
  }
  if (signal.driver_disabled) return "0"
  if (pattern === "clock") return "01"
  if (!prbs) return pattern

  let state = seed!
  const captureSeconds =
    durationSeconds - signal.offset_ms / MILLISECONDS_PER_SECOND
  const bitSeconds =
    MILLISECONDS_PER_SECOND / signal.bit_rate_bps / MILLISECONDS_PER_SECOND
  const intervals = captureSeconds / bitSeconds
  const roundingTolerance =
    Math.max(1, intervals) * Number.EPSILON * INTERVAL_ROUNDING_ULPS
  const count = Math.min(
    mask,
    Math.max(1, Math.ceil(intervals - roundingTolerance)),
  )
  if (!Number.isFinite(count) || count > MAX_STIMULUS_BITS) {
    throw new Error(
      `Signal "${signal.name}": ${pattern} patterns must contain at most ${MAX_STIMULUS_BITS} bits. Lower the bit rate or set duration to a shorter recording.`,
    )
  }
  const { width, tap } = prbs
  let bits = ""
  for (let i = 0; i < count; i++) {
    const highBit = state >>> (width - 1)
    const feedback = (highBit ^ (state >>> (tap - 1))) & 1
    bits = `${bits}${highBit & 1}`
    state = ((state << 1) | feedback) & mask
  }
  return bits
}

/** Append the experiment and probes while lowering pin states and stimuli. */
export function appendBlockControls({
  circuit,
  id,
  block,
  signals,
  pins,
  driven,
  durationSeconds,
  rate,
  stepSeconds,
}: ControlOptions): RunControls {
  const controls: RunControls = { states: [], stimuli: [] }
  const scope = circuit.find(
    (record) => record.type === "pcb_board",
  )?.subcircuit_id
  circuit.push({
    type: "simulation_experiment",
    simulation_experiment_id: id,
    name: block.name ?? id,
    experiment_type: "spice_transient_analysis",
    spice_engine: "pcb_spice",
    spice_options: { ...SPICE_OPTIONS },
    end_time_ms: durationSeconds * MILLISECONDS_PER_SECOND,
    start_time_ms: 0,
    time_per_step: stepSeconds * MILLISECONDS_PER_SECOND,
    subcircuit_id: scope,
  })
  for (const pin of pins.values()) {
    const signal = driven.get(pin.port)
    const capabilities = pinCapabilities(pin)
    const output = signal !== undefined || !capabilities.receive
    let enabled =
      capabilities.drive && !capabilities.disable && !capabilities.receive
    if (signal) enabled = !signal.driver_disabled
    const state: RunControls["states"][number] = {
      source_port_id: pin.port,
      is_output: output,
    }
    if (output) state.is_output_enabled = enabled
    controls.states.push(state)
    if (signal || !enabled) continue
    controls.stimuli.push({
      name: pin.port,
      source_port_id: pin.port,
      bit_duration_ms: MILLISECONDS_PER_SECOND / rate,
      start_time_ms: 0,
      initial_state: 0,
      inverted: pin.buffer.polarity === "inverting",
      transmission_pattern: {
        transmission_type: "bits",
        bits: "0",
        repeat: true,
      },
    })
  }
  for (const signal of signals) {
    const bits = signalBits({ signal, durationSeconds })
    if (signal.driver_disabled) continue
    let initialState: 0 | 1 = 0
    if (bits[0] === "1") initialState = 1
    let startTimeMs = signal.offset_ms
    if (isQuiet(signal)) startTimeMs = 0
    for (const [index, port] of endpointPorts(signal.driver).entries()) {
      const pin = pins.get(port)!
      const inversion = Boolean(index) !== (pin.buffer.polarity === "inverting")
      controls.stimuli.push({
        name: signal.name,
        source_port_id: port,
        bit_duration_ms: MILLISECONDS_PER_SECOND / signal.bit_rate_bps,
        start_time_ms: startTimeMs,
        initial_state: initialState,
        inverted: inversion,
        transmission_pattern: { transmission_type: "bits", bits, repeat: true },
      })
    }
  }
  for (const signal of signals) {
    for (const [index, endpoint] of probeEndpoints(signal).entries()) {
      const ports = endpointPorts(endpoint)
      let ref = ports[1]
      if (!("p_source_port_id" in endpoint))
        ref = pins.get(ports[0])!.references.pulldown
      circuit.push({
        type: "simulation_voltage_probe",
        simulation_voltage_probe_id: `${signal.simulation_pcb_driver_receiver_channel_id}_${index}`,
        name: `${signal.name}_${index}`,
        signal_input_source_port_id: ports[0],
        reference_input_source_port_id: ref,
        subcircuit_id: scope,
      })
    }
  }
  return controls
}

import { cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  type DriverPattern,
  endpointPorts,
  isQuiet,
  type SignalEndpoint,
  type SimulationExperiment,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SimulationPcbTransientChannelSimulationId,
  type SourcePortId,
} from "../board"
import type { InspectedPin } from "../buffers"
import { Diagnostic } from "../kernel"
import type { RunControls } from "../simulation"
import type { Aggressors } from "./aggressors"
import { defaultDurationSeconds, prbsPatterns } from "./timing"

/** Milliseconds in one second. */
const MILLISECONDS_PER_SECOND = 1000

/** Round bit intervals with the same floating-point tolerance as the IBIS converter. */
const INTERVAL_ROUNDING_ULPS = 8

/** The bit-string boundary must fit in one string in the supported Node runtime. */
const MAX_PATTERN_BITS = 2 ** 29 - 24

/** Solver error tolerances for the routed transient (relative, current in amps, voltage in volts). */
const SPICE_OPTIONS: NonNullable<SimulationExperiment["spice_options"]> = {
  reltol: 1e-5,
  abstol: 1e-12,
  vntol: 1e-8,
}

/** Set the maximum transient step relative to the shortest bit. */
const STEPS_PER_BIT = 100

/** Set the maximum transient step relative to the fastest edge. */
const STEPS_PER_EDGE = 20

/** Ensure the maximum step is strictly shorter than the recording. */
const MIN_STEPS_PER_RECORDING = 2

/** Circuit, inspected pins and timing used to lower a channel experiment. */
export interface ChannelSimulationControlOptions {
  circuit: CircuitJson
  simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  pins: Map<SourcePortId, InspectedPin>
  driven: Map<SourcePortId, SimulationPcbDriverReceiverChannel>
  aggressors: Aggressors
  durationSeconds: number
  stepSeconds: number
}

/** Fastest edge and maximum transient step for the recording. */
interface SignalTiming {
  fastestEdgeSeconds: number
  stepSeconds: number
}

/** Limit the step by the shortest bit, fastest edge and recording duration. */
export function signalTiming({
  patterns,
  durationSeconds,
  edgeTimesSeconds,
}: {
  patterns: readonly DriverPattern[]
  durationSeconds: number
  edgeTimesSeconds: number[]
}): SignalTiming {
  const fastestEdgeSeconds = Math.min(...edgeTimesSeconds)
  const rate = Math.max(...patterns.map((signal) => signal.bit_rate_bps))
  const stepSeconds = Math.min(
    1 / rate / STEPS_PER_BIT,
    fastestEdgeSeconds / STEPS_PER_EDGE,
    durationSeconds / MIN_STEPS_PER_RECORDING,
  )
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0)
    throw new Diagnostic(
      "pipeline",
      "simulation_timing",
      "Transient timestep must be finite and positive (time_per_step)",
    )
  return { fastestEdgeSeconds, stepSeconds }
}

/** Choose the capture duration in seconds and check coverage of enabled stimuli. */
export function channelSimulationDurationSeconds({
  channelSimulation,
  patterns,
}: {
  channelSimulation: SimulationPcbTransientChannelSimulation
  patterns: readonly DriverPattern[]
}): number {
  let durationSeconds: number
  if (channelSimulation.duration_ms === undefined)
    durationSeconds = defaultDurationSeconds(patterns)
  else durationSeconds = channelSimulation.duration_ms / MILLISECONDS_PER_SECOND
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Recording duration must be finite and positive.")
  }
  for (const signal of patterns) {
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
): readonly SignalEndpoint[] {
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
  signal: DriverPattern
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
  if (!prbs || seed === undefined) return pattern

  let state = seed
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
  if (!Number.isFinite(count)) {
    throw new Error(
      `Signal "${signal.name}": ${pattern} pattern length must be finite`,
    )
  }
  if (count > MAX_PATTERN_BITS) {
    throw new Diagnostic(
      "pipeline",
      "simulation_timing",
      `Signal "${signal.name}": ${pattern} pattern exceeds ${MAX_PATTERN_BITS} bits`,
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

/** Lower a bit pattern to the converter's stimulus for one physical port. */
function driverStimulus({
  name,
  signal,
  port,
  bits,
  inverted,
}: {
  name: string
  signal: DriverPattern
  port: SourcePortId
  bits: string
  inverted: boolean
}): RunControls["stimuli"][number] {
  let initialState: 0 | 1 = 0
  if (bits[0] === "1") initialState = 1
  let startTimeMs = signal.offset_ms
  if (isQuiet(signal)) startTimeMs = 0
  return {
    name,
    source_port_id: port,
    bit_duration_ms: MILLISECONDS_PER_SECOND / signal.bit_rate_bps,
    start_time_ms: startTimeMs,
    initial_state: initialState,
    inverted,
    transmission_pattern: { transmission_type: "bits", bits, repeat: true },
  }
}

/** Circuit with the lowered experiment and probes, plus their pin states and stimuli. */
interface ChannelSimulationControls {
  circuit: CircuitJson
  controls: RunControls
}

/** Lower pin states, stimuli, an experiment and its probes for one channel simulation. */
export function withChannelSimulationControls({
  circuit,
  simulationPcbTransientChannelSimulationId,
  channelSimulation,
  driverReceiverChannels,
  pins,
  driven,
  aggressors,
  durationSeconds,
  stepSeconds,
}: ChannelSimulationControlOptions): ChannelSimulationControls {
  const controls: RunControls = { states: [], stimuli: [] }
  const db = cju([...circuit])
  const scope = db.pcb_board.getWhere({})?.subcircuit_id
  const records: CircuitJson[number][] = []
  records.push({
    type: "simulation_experiment",
    simulation_experiment_id: simulationPcbTransientChannelSimulationId,
    name: channelSimulation.name ?? simulationPcbTransientChannelSimulationId,
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
    const aggressor = aggressors.get(pin.port)
    const state: RunControls["states"][number] = {
      source_port_id: pin.port,
      is_output: signal !== undefined || aggressor !== undefined,
    }
    if (signal) state.is_output_enabled = !signal.driver_disabled
    else if (aggressor !== undefined)
      state.is_output_enabled = aggressor !== null
    controls.states.push(state)
    if (!aggressor) continue
    controls.stimuli.push(
      driverStimulus({
        name: pin.port,
        signal: aggressor,
        port: pin.port,
        bits: signalBits({ signal: aggressor, durationSeconds }),
        inverted: pin.buffer.polarity === "inverting",
      }),
    )
  }
  for (const signal of driverReceiverChannels) {
    const bits = signalBits({ signal, durationSeconds })
    if (signal.driver_disabled) continue
    for (const [index, port] of endpointPorts(signal.driver).entries()) {
      const pin = pins.get(port)!
      const inverted = Boolean(index) !== (pin.buffer.polarity === "inverting")
      controls.stimuli.push(
        driverStimulus({ name: signal.name, signal, port, bits, inverted }),
      )
    }
  }
  for (const signal of driverReceiverChannels) {
    for (const [index, endpoint] of probeEndpoints(signal).entries()) {
      const ports = endpointPorts(endpoint)
      let ref = ports[1]
      if (!("p_source_port_id" in endpoint))
        ref = pins.get(ports[0])!.references.pulldown
      records.push({
        type: "simulation_voltage_probe",
        simulation_voltage_probe_id: `${signal.simulation_pcb_driver_receiver_channel_id}_${index}`,
        name: `${signal.name}_${index}`,
        signal_input_source_port_id: ports[0],
        reference_input_source_port_id: ref,
        subcircuit_id: scope,
      })
    }
  }
  return { circuit: [...circuit, ...records], controls }
}

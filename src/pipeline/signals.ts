import { cju } from "@tscircuit/circuit-json-util"
import type {
  CircuitJson,
  DriverPattern,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
  SimulationPcbTransientChannelSimulationId,
  SourcePortId,
} from "../board"
import { isQuiet } from "../board"
import {
  edgeDurationSeconds,
  type IbisSources,
  type InspectedPin,
} from "../buffers"
import { type SafeId, safeId } from "../kernel"
import type { RunControls } from "../simulation"
import { planAggressors } from "./aggressors"
import { listChannelSimulations } from "./channel-simulation-declarations"
import { prepareTraceContacts } from "./channel-traces"
import type { NumericalSettings } from "./modeling"
import {
  type ChannelSimulationControlOptions,
  channelSimulationDurationSeconds,
  signalTiming,
  withChannelSimulationControls,
} from "./signal-controls"
import {
  channelSimulationCircuit,
  validateComponentModels,
  withUsedIbisModels,
} from "./signal-models"
import { compareNames } from "./signal-names"
import { prepareSignalSettings } from "./signal-settings"

export { listChannelSimulations } from "./channel-simulation-declarations"

import {
  inspectSignalPins,
  scopeSignalPins,
  validateSignalPins,
} from "./signal-pins"

export { probeEndpoints, signalBits } from "./signal-controls"

/** Default lateral search distance for channel simulation planning, in millimetres. */
const DEFAULT_NEARBY_GAP_MM = 32

/** The lowered circuit and controls for a single transient channel simulation. */
export interface PreparedChannelSimulation {
  warnings?: string[]
  durationSeconds: number
  fastestEdgeSeconds: number
  stepSeconds: number
  channelSimulation: SimulationPcbTransientChannelSimulation
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  circuit: CircuitJson
  controls: Record<string, RunControls>
  pins: Map<SourcePortId, InspectedPin>
  settings: NumericalSettings
}

/** Shared by the search gap error and the plan drawing. */
export const INVALID_NEARBY_GAP_MESSAGE =
  "Copper search gap must be finite and positive (mm)."

/** Normalize a caller's nearby copper gap at the preparation boundary. */
export function validateNearbyGapMm(
  nearbyGapMm: number = DEFAULT_NEARBY_GAP_MM,
): number {
  if (!Number.isFinite(nearbyGapMm) || nearbyGapMm <= 0) {
    throw new Error(INVALID_NEARBY_GAP_MESSAGE, {
      cause: "nearbyGapMm",
    })
  }
  return nearbyGapMm
}

/** Validate one channel simulation and lower its test intent to the private routed declarations. */
export function prepareChannelSimulationById({
  circuit,
  sources,
  simulationPcbTransientChannelSimulationId,
  distanceMm,
}: {
  circuit: CircuitJson
  sources: IbisSources
  simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
  distanceMm?: number
}): PreparedChannelSimulation {
  const nearbyGapMm = validateNearbyGapMm(distanceMm)
  const channelSimulations = listChannelSimulations(circuit)
  const matches = channelSimulations.filter(
    (channelSimulation) =>
      channelSimulation.simulation_pcb_transient_channel_simulation_id ===
      simulationPcbTransientChannelSimulationId,
  )
  if (matches.length !== 1)
    throw new Error(
      `Expected exactly one transient channel simulation ${simulationPcbTransientChannelSimulationId}`,
    )
  return prepareChannelSimulation({
    boardCircuitJson: circuit,
    channelSimulation: matches[0],
    simulationPcbTransientChannelSimulationId: safeId({
      raw: simulationPcbTransientChannelSimulationId,
      field: "simulationPcbTransientChannelSimulationId",
    }),
    sources,
    nearbyGapMm,
  })
}

/** One channel simulation's validated records. */
interface ChannelSelection {
  channelSimulation: SimulationPcbTransientChannelSimulation
  simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
  driverReceiverChannels: SimulationPcbDriverReceiverChannel[]
  circuit: CircuitJson
}

/** Require at least one channel with distinct names and record IDs. */
function validateChannelNames({
  channelSimulation,
  driverReceiverChannels,
  simulationPcbTransientChannelSimulationId,
}: Pick<
  ChannelSelection,
  | "channelSimulation"
  | "driverReceiverChannels"
  | "simulationPcbTransientChannelSimulationId"
>): void {
  const signalNames = new Set(
    driverReceiverChannels.map((signal) => signal.name),
  )
  const simulationPcbDriverReceiverChannelIds = new Set(
    driverReceiverChannels.map(
      (signal) => signal.simulation_pcb_driver_receiver_channel_id,
    ),
  )
  if (
    !driverReceiverChannels.length ||
    signalNames.size !== driverReceiverChannels.length ||
    simulationPcbDriverReceiverChannelIds.size !== driverReceiverChannels.length
  ) {
    throw new Error(
      `${channelSimulation.name || simulationPcbTransientChannelSimulationId}: require distinct named signals`,
    )
  }
}

/** Select the simulation's channels in stable name order. */
function selectChannelSimulation({
  boardCircuitJson,
  channelSimulation,
  simulationPcbTransientChannelSimulationId,
}: Pick<
  ChannelSimulationOptions,
  | "boardCircuitJson"
  | "channelSimulation"
  | "simulationPcbTransientChannelSimulationId"
>): ChannelSelection {
  const db = cju([...boardCircuitJson])
  const driverReceiverChannels = db.simulation_pcb_driver_receiver_channel.list(
    {
      simulation_pcb_transient_channel_simulation_id:
        simulationPcbTransientChannelSimulationId,
    },
  )
  driverReceiverChannels.sort((a, b) => compareNames({ a: a.name, b: b.name }))
  validateChannelNames({
    channelSimulation,
    driverReceiverChannels,
    simulationPcbTransientChannelSimulationId,
  })
  const circuit = channelSimulationCircuit({
    db,
    channelSimulation,
    driverReceiverChannels,
  })
  return {
    circuit,
    channelSimulation,
    simulationPcbTransientChannelSimulationId,
    driverReceiverChannels,
  }
}

/** A board and one validated simulation declaration with its model sources and radius. */
interface ChannelSimulationOptions {
  boardCircuitJson: CircuitJson
  channelSimulation: SimulationPcbTransientChannelSimulation
  simulationPcbTransientChannelSimulationId: SafeId
  sources: IbisSources
  nearbyGapMm: number
  captureDrivers?: boolean
  disabledAggressorPorts?: readonly SourcePortId[]
}

/** Lower controls and assemble the prepared simulation. */
function withPreparedChannelControls({
  settings,
  warnings,
  fastestEdgeSeconds,
  ...options
}: ChannelSimulationControlOptions & {
  settings: NumericalSettings
  warnings: string[]
  fastestEdgeSeconds: number
}): PreparedChannelSimulation {
  const { circuit, controls } = withChannelSimulationControls(options)
  const {
    channelSimulation,
    driverReceiverChannels,
    durationSeconds,
    pins,
    simulationPcbTransientChannelSimulationId,
  } = options
  const prepared: PreparedChannelSimulation = {
    channelSimulation,
    driverReceiverChannels,
    circuit,
    controls: { [simulationPcbTransientChannelSimulationId]: controls },
    pins,
    settings,
    durationSeconds,
    fastestEdgeSeconds,
    stepSeconds: options.stepSeconds,
  }
  if (warnings.length) prepared.warnings = warnings
  return prepared
}

/** Prepare one channel simulation from its declarations through controls and probes. */
export function prepareChannelSimulation(
  options: ChannelSimulationOptions,
): PreparedChannelSimulation {
  const { sources, nearbyGapMm, captureDrivers, disabledAggressorPorts } =
    options
  const { circuit, ...selection } = selectChannelSimulation(options)
  const inspection = { ...selection, circuit, sources, nearbyGapMm }
  const signalPins = inspectSignalPins(inspection)
  const scopedPins = scopeSignalPins({ ...inspection, signalPins })
  const scoped = { ...selection, ...scopedPins, circuit, signalPins }
  validateSignalPins(scoped)
  const aggressors = planAggressors({
    ...scoped,
    driven: signalPins.driven,
    disabledPorts: disabledAggressorPorts,
  })
  const patterns: DriverPattern[] = [...selection.driverReceiverChannels]
  const edgeTimesSeconds = [...signalPins.edgeTimesSeconds]
  for (const [port, signal] of aggressors) {
    if (signal === null || isQuiet(signal)) continue
    patterns.push(signal)
    edgeTimesSeconds.push(edgeDurationSeconds(scoped.pins.get(port)!))
  }
  const durationSeconds = channelSimulationDurationSeconds({
    channelSimulation: selection.channelSimulation,
    patterns,
  })
  const timing = signalTiming({ patterns, durationSeconds, edgeTimesSeconds })
  validateComponentModels({ ...scoped, topology: signalPins.topology })
  const traceContacts = prepareTraceContacts(scoped)
  const pruned = withUsedIbisModels(scoped)
  const supplied = prepareSignalSettings({
    pruned,
    signalPins,
    scopedPins,
    traceContacts,
    sources,
  })
  return withPreparedChannelControls({
    ...selection,
    ...timing,
    ...supplied,
    durationSeconds,
    aggressors,
    captureDrivers,
    pins: pruned.pins,
    driven: signalPins.driven,
  })
}

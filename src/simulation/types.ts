// Declaration and plan shapes the routed bindings and deck consume.

import type { SourcePort } from "circuit-json"
import type {
  PortSelector,
  SimulationExperiment,
  SimulationIbisModel,
  SourceNetId,
  SourcePortId,
} from "../board"
import type { Snapshot } from "../kernel"

/** simulation's slice of the flat public `Modeling`. (`channelReference` is shared with board's slice.) */
export interface SimulationModeling {
  channelReference?: PortSelector
  supplies?: {
    positive: PortSelector
    negative: PortSelector
    voltageV: number
  }[]
  passiveComponents?: {
    sourceComponentId?: string
    component?: string
  }[]
}

/** A SPICE node name in the generated circuit. */
export type SpiceNodeName = string

/** SPICE node names indexed by source port or net id. */
type CircuitNodeNames = Readonly<
  Record<SourcePortId | SourceNetId, SpiceNodeName>
>

/** The SPICE node lookup and mapping for an experiment's source connectivity. */
export interface CircuitNodes {
  node(id: SourcePortId | SourceNetId): SpiceNodeName
  groundSourcePortId: SourcePortId
  mapping: CircuitNodeNames
}
export type PipelineIbisModel = Snapshot<SimulationIbisModel> & {
  pipelineId: string
}
export interface VoltageProbePlan {
  simulationVoltageProbeId: string
  name: string
  column: number
  signalSourceId: SourcePortId | SourceNetId
  referenceSourceId: SourcePortId | SourceNetId | null
  signalNode: string
  referenceNode: string
}
/** Run controls lowered from channel declarations for the IBIS converter. */
export interface RunControls {
  states: {
    source_port_id: SourcePortId
    is_output: boolean
    is_output_enabled?: boolean
  }[]
  stimuli: {
    name: string
    source_port_id: SourcePortId
    bit_duration_ms: number
    start_time_ms: number
    initial_state: 0 | 1
    inverted?: boolean
    transmission_pattern: {
      transmission_type: "bits"
      bits: string
      repeat: boolean
    }
  }[]
}
export interface SimulationPlan extends RunControls {
  simulationExperimentId: string
  name: string
  subcircuitId: string | null
  durationSeconds: number
  startTimeSeconds: number
  maxStepSeconds: number
  experiment: Snapshot<SimulationExperiment>
  probes: VoltageProbePlan[]
  models: PipelineIbisModel[]
}
/** Today's generalDeclarations return value. `models` holds only models some plan uses, in declaration order. */
export interface Declarations {
  models: PipelineIbisModel[]
  nodes: CircuitNodes
  plans: SimulationPlan[]
  ports: ReadonlyMap<SourcePortId, SourcePort>
}

/** Deck lines and electrical node evidence for the modeled voltage sources and passives. */
export interface ElectricalSources {
  lines: string[]
  activeNodes: Set<string>
  grounded: Set<string>
  sourceBindings: Array<{
    name: string
    positiveNode: string
    negativeNode: string
  }>
  scope: {
    voltageSources: number
    passiveComponents: number
    unselectedBoardComponents: string
  }
}

// Declaration and plan shapes the routed bindings and deck consume.
import type { CircuitJson, PortSelector, SimulationExperiment, SimulationIbisModel } from '../board'

/** simulation's slice of the flat public `Modeling`. (`channelReference` is shared with board's slice.) */
export interface SimulationModeling {
  channelReference?: PortSelector
  supplies?: { positive: PortSelector; negative: PortSelector; voltageV: number }[]
  passiveComponents?: { sourceComponentId?: string; component?: string }[]
}

export interface CircuitNodes {
  node(id: string): string
  groundSourcePortId: string
  mapping: Record<string, string>
}
export type PipelineIbisModel = SimulationIbisModel & { pipelineId: string }
export interface VoltageProbePlan {
  simulationVoltageProbeId: string
  name: string
  column: number
  signalSourceId: string
  referenceSourceId: string | null
  signalNode: string
  referenceNode: string
}
/** Run controls lowered from channel declarations for the IBIS converter. */
export interface RunControls {
  states: { source_port_id: string; is_output: boolean; is_output_enabled?: boolean }[]
  stimuli: {
    name: string; source_port_id: string; bit_duration_ms: number; start_time_ms: number; initial_state: 0 | 1; inverted?: boolean
    transmission_pattern: { transmission_type: 'bits'; bits: string; repeat: boolean }
  }[]
}
export interface SimulationPlan extends RunControls {
  simulationExperimentId: string
  name: string
  subcircuitId: string | null
  durationSeconds: number
  startTimeSeconds: number
  maxStepSeconds: number
  experiment: SimulationExperiment
  probes: VoltageProbePlan[]
  models: PipelineIbisModel[]
}
/** Today's generalDeclarations return value. `models` holds only models some plan uses, in declaration order. */
export interface Declarations {
  models: PipelineIbisModel[]
  nodes: CircuitNodes
  plans: SimulationPlan[]
  ports: Map<string, Extract<CircuitJson[number], { type: 'source_port' }>>
}

export interface ElectricalSources {
  lines: string[]
  activeNodes: Set<string>
  grounded: Set<string>
  sourceBindings: Array<{ name: string; positiveNode: string; negativeNode: string }>
  scope: { voltageSources: number; passiveComponents: number; unselectedBoardComponents: string }
}

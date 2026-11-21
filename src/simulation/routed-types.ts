import type { CircuitJson, CopperScope, LaneMapping } from "../board"
import type { IbisSources } from "../buffers"
import type { RunControls, SimulationModeling } from "./types"

/** Timing and mesh settings shared by the routed simulation stages. */
export interface RoutedCompileOptions {
  riseSeconds: number
  refinement: number
  durationSeconds: number
  stepSeconds: number
}
/** Geometry-independent data required to bind ports to routed IBIS buffers. */
export interface RouteBindingsInput {
  circuitJson: CircuitJson
  scope: CopperScope
  mappings: LaneMapping[]
  modeling: SimulationModeling
  controls: Record<string, RunControls>
  ibisSources: IbisSources
  options: RoutedCompileOptions
  artifactPrefix: string
}

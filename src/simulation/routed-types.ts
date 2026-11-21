import type {
  CircuitJson,
  CopperScope,
  LaneMapping,
  SectionGeometry,
  SourcePortId,
} from "../board"
import type { CompiledBuffer, IbisSources } from "../buffers"
import type { ExtractedRoutes, RouteMaterials } from "../extraction"
import type {
  CircuitNodes,
  RunControls,
  SimulationModeling,
  SimulationPlan,
  VoltageProbePlan,
} from "./types"

/** Timing and mesh settings shared by the routed simulation stages. */
export interface RoutedCompileOptions {
  riseSeconds: number
  refinement: number
  durationSeconds: number
  stepSeconds: number
  panels?: number
  currentToleranceA?: number
  cellsPerRise?: number
  materials?: RouteMaterials
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
/** Compiled IBIS buffer data needed to wire a routed deck. */
export type RouteBuffer = Pick<
  CompiledBuffer,
  | "name"
  | "source"
  | "spicePinMapping"
  | "metadata"
  | "warnings"
  | "sourceEvidence"
>
/** Immutable circuit nodes, compiled buffers and inputs for the route network. */
export interface RoutedBindings {
  circuitJson: CircuitJson
  scope: CopperScope
  mappings: LaneMapping[]
  plan: SimulationPlan
  nodeMap: CircuitNodes["mapping"]
  groundSourcePortId: SourcePortId
  electricalLines: string[]
  models: RouteBuffer[]
}
/** Scoped geometry, field results and electrical bindings for a routed deck. */
export interface RouteNetworkInput {
  blockId: string
  name: string
  geometry: SectionGeometry
  extracted: ExtractedRoutes
  bindings: RoutedBindings
  materials: RouteMaterials
  options: RoutedCompileOptions
  warnings: string[]
  artifactPrefix: string
}
/** Executable SPICE input and evidence for one routed transient. */
export interface RoutedDeck {
  blockId: string
  name: string
  deck: string
  requestSha256: string
  probes: VoltageProbePlan[]
  durationSeconds: number
  stepSeconds: number
  evidence: Record<string, unknown>
}

import type {
  CircuitJson,
  CopperScope,
  ReceiverTracePath,
  SourcePortId,
  SourceTraceId,
} from "../board"
import type { CompiledIbisComponent, IbisSources } from "../buffers"
import type { Snapshot } from "../kernel"
import type {
  CircuitNodes,
  RunControls,
  SimulationModeling,
  SimulationPlan,
} from "./types"

/** Timing and mesh settings shared by the routed simulation stages. */
export interface RouteCompileOptions {
  readonly fastestEdgeSeconds: number
  readonly refinement: number
  readonly durationSeconds: number
  readonly stepSeconds: number
}
/** One physical conductor removed from ideal connectivity for routed extraction. */
export interface TraceContacts {
  readonly sourceTraceId: SourceTraceId
  readonly fromSourcePortId: SourcePortId
  readonly toSourcePortId: SourcePortId
}

/** Board, receiver paths and trace contacts for routed IBIS binding. */
export interface RouteBindingsInput {
  readonly circuitJson: Snapshot<CircuitJson>
  readonly receiverPaths: readonly ReceiverTracePath[]
  readonly traceContacts: readonly TraceContacts[]
  readonly modeling: Snapshot<SimulationModeling>
  readonly controls: Snapshot<Record<string, RunControls>>
  readonly ibisSources: Readonly<IbisSources>
  readonly options: RouteCompileOptions
  readonly artifactPrefix: string
}
/** Planned binding inputs and the copper scope resolved by route sectioning. */
export interface ScopedRouteBindingsInput extends RouteBindingsInput {
  readonly copperScope: Snapshot<CopperScope>
}

/** Compiled IBIS buffer data needed to wire a routed deck. */
export type RouteBuffer = Pick<
  CompiledIbisComponent,
  | "name"
  | "source"
  | "spicePinMapping"
  | "metadata"
  | "warnings"
  | "sourceEvidence"
>
/** Immutable circuit nodes, compiled buffers and inputs for the route network. */
export type RoutedBindings = Snapshot<{
  circuitJson: CircuitJson
  scope: CopperScope
  receiverPaths: readonly ReceiverTracePath[]
  plan: SimulationPlan
  nodeMap: CircuitNodes["mapping"]
  groundSourcePortId: SourcePortId
  electricalLines: string[]
  models: RouteBuffer[]
}>

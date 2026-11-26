import type {
  CircuitJson,
  ReceiverTracePath,
  SourcePortId,
  SourceTraceId,
} from "../board"
import type { IbisSources } from "../buffers"
import type { Snapshot } from "../kernel"
import type { RunControls, SimulationModeling } from "./types"

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

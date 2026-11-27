import type { CopperGeometry, SourcePortId, SourceTraceId } from "../board"
import type { Snapshot } from "../kernel"
import type { DielectricMaterials, TransmissionLineRlgc } from "../rlgc"
import type { ChannelNetlist } from "./channel-netlist"
import type { VoltageProbePlan } from "./types"

/** Settings for the route ladder mesh and convergence. */
export interface RouteCompileOptions {
  readonly fastestEdgeSeconds: number
  readonly refinement: number
  panels?: number
  currentToleranceA?: number
  cellsPerRise?: number
}

/** One physical conductor removed from ideal connectivity for routed extraction. */
export interface TraceContacts {
  readonly sourceTraceId: SourceTraceId
  readonly fromSourcePortId: SourcePortId
  readonly toSourcePortId: SourcePortId
}
/** Scoped copper, extracted fields and channel netlist for a routed deck. */
export interface RouteNetworkInput {
  simulationPcbTransientChannelSimulationId: string
  name: string
  copperGeometry: CopperGeometry
  extracted: TransmissionLineRlgc
  channelNetlist: ChannelNetlist
  materials: DielectricMaterials
  options: RouteCompileOptions
  warnings: readonly string[]
  artifactPrefix: string
}
/** Executable SPICE input and evidence for one routed transient. */
export type RoutedDeck = Snapshot<{
  simulationPcbTransientChannelSimulationId: string
  name: string
  deck: string
  requestSha256: string
  probes: VoltageProbePlan[]
  durationSeconds: number
  stepSeconds: number
  evidence: Record<string, unknown>
}>

import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { Line, Point, Polygon } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId, SourceTraceId } from "./ids"
import type { PlanHeaderRow } from "./plan-header"
import type { PlanPorts } from "./plan-view"

/** Colors distinguish secondary copper and topology on a light canvas. */
export const planColors = {
  ink: "#0f172a",
  quiet: "#475569",
  scope: "#0f766e",
  nearby: "#48958e",
  rail: "#a45a70",
  existing: "#39789a",
  excluded: "#cbd5e1",
  series: "#b45309",
  ideal: "#4338ca",
  failure: "#b91c1c",
} as const

/** Translucent pours leave traces and layer overlaps visible. */
export const planPourFills = {
  pink: "rgba(219,39,119,0.06)",
  gray: "rgba(100,116,139,0.08)",
} as const

/** Distinct strokes for adjacent traces and their path rows. */
const TRACE_COLORS = [
  "#0369a1",
  "#b45309",
  "#047857",
  "#6d28d9",
  "#be185d",
  "#0e7490",
]

/** Match each trace to its endpoint markers and path row. */
export function getTraceColor(index: number): string {
  return TRACE_COLORS[index % TRACE_COLORS.length]
}

/** A trace oriented for its first receiver path. */
export interface PlanTrace {
  sourceTraceId: SourceTraceId
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  index: number
  isOnReceiverPath: boolean
}

/** A point-to-point topology overlay independent of the physical copper. */
export interface PlanOverlay {
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  kind: "series" | "ideal" | "missing" | "short"
  label: string
}

/** A pin's role and the trace or path color to use for its marker. */
export interface PlanVisualEndpoint {
  sourcePortId: SourcePortId
  kind: "driver" | "receiver" | "ideal" | "extraTraceEnd"
  color: string
  label: string
  towardSourcePortId?: SourcePortId
}

/** A drawing's visible explanation and the original diagnostic on hover. */
export interface PlanVisualDiagnostic {
  text: string
  label: string
}

/** The summary in a full-board or cropped view. */
export interface PlanVisualSummary {
  text: string
  scopedText?: string
}

/** Electrical mark carried through line clipping for the legend. */
export interface PlanLine extends Line {
  mark?: "envelope" | "ideal" | "missing" | "bypass" | "traceFault"
}

/** Endpoint symbol carried through polygon clipping for the legend. */
export interface PlanPolygon extends Polygon {
  holes?: Point[][]
  endpointKind?: PlanVisualEndpoint["kind"]
}

/** Board geometry and resolved decisions from a single planning attempt. */
export interface PlanVisualScene {
  db: CircuitJsonUtilObjects
  ports: PlanPorts
  title: string
  diagnostic?: PlanVisualDiagnostic
  copperScope?: Snapshot<CopperScope>
  traces: readonly PlanTrace[]
  endpoints: readonly PlanVisualEndpoint[]
  overlays: readonly PlanOverlay[]
  summary?: PlanVisualSummary
  rows: readonly PlanHeaderRow[]
  traceFaultKind?: "branch" | "loop"
  faultSourcePortIds: ReadonlySet<SourcePortId>
  faultSourceTraceIds: ReadonlySet<SourceTraceId>
  existingSourceTraceIds: ReadonlySet<SourceTraceId>
}

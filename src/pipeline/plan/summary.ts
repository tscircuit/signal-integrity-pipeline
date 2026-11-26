import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  getPinName,
  type PlanVisualScene,
  type SourcePortId,
} from "../../board"
import type { Diagnostic } from "../../kernel"
import { INVALID_NEARBY_GAP_MESSAGE } from "../signals"
import type { PlanFault } from "./fault"
import { formatMillimeters } from "./measure"
import {
  describeSeriesPart,
  findPinPart,
  formatCount,
  getSegmentKey,
  orderExtraTraces,
} from "./rows"
import type { FailedPlanAttempt, PlanPath } from "./visual"
import type { PlanTopology } from "./visual-topology"

/** Join names or quantities as they would appear in a sentence. */
function joinParts(parts: readonly string[]): string {
  if (parts.length <= 2) return parts.join(" and ")
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
}

/** Choose the final clause that explains how the diagram includes extra copper. */
function describeExtraTraces({
  topology,
  db,
}: {
  topology: PlanTopology
  db: CircuitJsonUtilObjects
}): string {
  const extras = orderExtraTraces(topology)
  if (!extras.length) return ""
  if (extras.length > 1) return `; ${extras.length} extra traces are included.`
  const part = findPinPart({ sourcePortId: extras[0].toSourcePortId, db })?.name
  if (part) return `; 1 extra trace to ${part} is included.`
  return "; 1 extra trace is included."
}

/** Summarize the signal routes and provide scope wording for a cropped copper area. */
export function summarizePlan({
  topology,
  db,
  nearbyGapMm,
}: {
  topology: PlanTopology
  db: CircuitJsonUtilObjects
  nearbyGapMm?: number
}): PlanVisualScene["summary"] {
  const signals = [
    ...new Set(topology.paths.map(({ channelName }) => channelName)),
  ]
  if (!signals.length) return
  const receivers = [
    ...new Set(
      topology.paths.map(
        ({ toSourcePortId }) =>
          findPinPart({ sourcePortId: toSourcePortId, db })?.name ||
          getPinName({ sourcePortId: toSourcePortId, db }),
      ),
    ),
  ]
  const pathSegments = [
    ...new Map(
      topology.paths.flatMap(({ pathSegments }) =>
        pathSegments.map((segment) => [getSegmentKey(segment), segment]),
      ),
    ).values(),
  ]
  const traceCount = pathSegments.filter(({ kind }) => kind === "trace").length
  const series = pathSegments.filter(({ kind }) => kind === "series")
  const idealConnectionCount = pathSegments.filter(
    ({ kind }) => kind === "ideal",
  ).length
  const phrases: string[] = []
  if (traceCount)
    phrases.push(formatCount({ count: traceCount, noun: "trace" }))
  if (series.length === 1)
    phrases.push(
      `series ${describeSeriesPart({ fromSourcePortId: series[0].fromSourcePortId, db })}`,
    )
  else if (series.length)
    phrases.push(formatCount({ count: series.length, noun: "series part" }))
  if (idealConnectionCount)
    phrases.push(
      formatCount({ count: idealConnectionCount, noun: "ideal connection" }),
    )

  let headline = `${signals.length} signals reach ${formatCount({ count: receivers.length, noun: "receiver" })}`
  let route = ` across ${formatCount({ count: traceCount, noun: "trace" })}`
  if (series.length || idealConnectionCount)
    route = ` through ${joinParts(phrases)}`
  if (signals.length === 1) {
    let targets = formatCount({ count: receivers.length, noun: "receiver" })
    if (receivers.length <= 2) targets = joinParts(receivers)
    headline = `${signals[0]} reaches ${targets}`
    route = ""
    if (phrases.length) route = ` through ${joinParts(phrases)}`
  }
  const extras = describeExtraTraces({ topology, db })
  if (signals.length === 1) headline += route
  const summary = { text: `${headline}.` }
  if (extras) summary.text = headline + extras
  else if (signals.length > 1) summary.text = `${headline}${route}.`
  if (nearbyGapMm === undefined) return summary
  return {
    ...summary,
    scopedText: `${summary.text} Copper search gap: ${formatMillimeters(nearbyGapMm)}.`,
  }
}

/** Use a reference designator for the summary, with the pin as its fallback. */
function describePartOrPin({
  sourcePortId,
  db,
}: {
  sourcePortId: SourcePortId
  db: CircuitJsonUtilObjects
}): string {
  return (
    findPinPart({ sourcePortId, db })?.name || getPinName({ sourcePortId, db })
  )
}

/** Describe the traces and series parts the bypass skips. */
function describeBypass({
  fromSourcePortId,
  toSourcePortId,
  paths,
  topology,
  fault,
  db,
}: {
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
  paths: readonly PlanPath[]
  topology?: PlanTopology
  fault: PlanFault
  db: CircuitJsonUtilObjects
}): string {
  const route = topology?.paths.find(({ pathSegments }) =>
    [fromSourcePortId, toSourcePortId].every((sourcePortId) =>
      pathSegments.some(
        (segment) =>
          segment.fromSourcePortId === sourcePortId ||
          segment.toSourcePortId === sourcePortId,
      ),
    ),
  )
  const path =
    paths.find(
      (path) =>
        path.fromSourcePortId === fromSourcePortId &&
        path.toSourcePortId === toSourcePortId,
    ) ||
    paths.find(
      (path) =>
        path.fromSourcePortId === toSourcePortId &&
        path.toSourcePortId === fromSourcePortId,
    ) ||
    route
  const contacts = new Set(
    topology?.traces
      .filter(({ sourceTraceId }) => fault.sourceTraceIds.has(sourceTraceId))
      .flatMap(({ fromSourcePortId, toSourcePortId }) => [
        fromSourcePortId,
        toSourcePortId,
      ]),
  )
  const series =
    topology?.overlays.filter(
      (overlay) =>
        overlay.kind === "series" &&
        [overlay.fromSourcePortId, overlay.toSourcePortId].every(
          (sourcePortId) =>
            contacts.has(sourcePortId) || fault.sourcePortIds.has(sourcePortId),
        ),
    ) || []
  const skipped = series.map(({ fromSourcePortId }) => {
    if (fault.sourceTraceIds.size)
      return describePartOrPin({ sourcePortId: fromSourcePortId, db })
    return describeSeriesPart({ fromSourcePortId, db })
  })
  if (fault.sourceTraceIds.size === 1) skipped.push("the trace")
  else if (fault.sourceTraceIds.size === 2) skipped.push("both traces")
  else if (fault.sourceTraceIds.size > 2)
    skipped.push(`${fault.sourceTraceIds.size} traces`)
  let start = fromSourcePortId
  let end = toSourcePortId
  if (path?.fromSourcePortId === toSourcePortId)
    [start, end] = [toSourcePortId, fromSourcePortId]
  const text = `${path?.legLabel || "The signal"} has a bypass from ${describePartOrPin({ sourcePortId: start, db })} to ${describePartOrPin({ sourcePortId: end, db })}`
  if (!skipped.length) return `${text}.`
  return `${text}, skipping ${joinParts(skipped)}.`
}

/** State the problem supported by the diagnostic's board and path evidence. */
function describePlanFailure({
  issue,
  error,
  paths,
  topology,
  fault,
  db,
}: {
  issue?: Diagnostic
  error: unknown
  paths: readonly PlanPath[]
  topology?: PlanTopology
  fault: PlanFault
  db: CircuitJsonUtilObjects
}): string {
  if (error instanceof Error && error.cause === "nearbyGapMm")
    return INVALID_NEARBY_GAP_MESSAGE
  const path = fault.incompletePaths[0]
  if (issue?.code === "circuit_schema" || issue?.code === "ibis_asset")
    return issue.message
  if (
    issue?.code === "simulation_timing" ||
    issue?.code === "ibis_asset_missing"
  )
    return issue.message.slice(issue.code.length + 2)
  if (path) {
    const { fromSourcePortId, toSourcePortId, legLabel } = path
    const fromPart = findPinPart({ sourcePortId: fromSourcePortId, db })?.name
    const toPart = findPinPart({ sourcePortId: toSourcePortId, db })?.name
    if (issue?.code === "channel_receiver_terminal_missing")
      return `${getPinName({ sourcePortId: toSourcePortId, db })} has no board pad to receive ${legLabel} from ${describePartOrPin({ sourcePortId: fromSourcePortId, db })}.`
    if (fromPart && toPart && fromPart !== toPart)
      return `${legLabel} has an incomplete route between ${fromPart} and ${toPart}.`
    return `${legLabel} has an incomplete route from ${getPinName({ sourcePortId: fromSourcePortId, db })} to ${getPinName({ sourcePortId: toSourcePortId, db })}.`
  }
  const pins = [...fault.sourcePortIds]
  const names = pins.map((sourcePortId) => getPinName({ sourcePortId, db }))
  if (issue?.code === "channel_driver_terminal_missing" && names.length) {
    const driver = paths.find(({ fromSourcePortId }) =>
      fault.sourcePortIds.has(fromSourcePortId),
    )
    return `${names[0]} has no board pad to drive ${driver?.legLabel || "the signal"}.`
  }
  if (issue?.code === "channel_fanout") {
    if ("rejections" in issue) return issue.message.slice(issue.code.length + 2)
    if (issue.hint) return issue.hint
  }
  if (issue?.code === "channel_fanout" && fault.sourceTraceIds.size) {
    const parts = new Set(
      pins.map((sourcePortId) => describePartOrPin({ sourcePortId, db })),
    )
    return `Traces through ${[...parts].join(", ")} form a loop.`
  }
  if (issue?.code === "channel_fanout" && names.length)
    return `Route from ${names[0]} branches; only a single path is supported.`
  if (issue?.code === "channel_short") {
    const grounded = pins.find(
      (sourcePortId) =>
        topology?.spiceNodeNamesBySourceContactId[sourcePortId] === "0",
    )
    if (grounded)
      return `${getPinName({ sourcePortId: grounded, db })} is shorted to ground.`
    const bypass = fault.overlays.find(({ kind }) => kind === "short")
    if (bypass) return describeBypass({ ...bypass, paths, topology, fault, db })
    if (names.length === 2)
      return `${names.join(" and ")} are shorted together.`
    if (names.length) return `Short found at ${names.join(", ")}.`
  }
  return "Simulation setup could not be planned; check the board and settings."
}

/** Build visible failure text and keep the original diagnostic for hover. */
export function buildSceneDiagnostic({
  error,
  failed,
  issue,
  paths,
  topology,
  fault,
  db,
}: {
  error: string | null
  failed?: FailedPlanAttempt
  issue?: Diagnostic
  paths: readonly PlanPath[]
  topology?: PlanTopology
  fault: PlanFault
  db: CircuitJsonUtilObjects
}): PlanVisualScene["diagnostic"] {
  let message = issue?.message || error
  if (failed?.error instanceof Error) message = failed.error.message
  if (message)
    return {
      text: describePlanFailure({
        issue,
        error: failed?.error,
        paths,
        topology,
        fault,
        db,
      }),
      label: message,
    }
}

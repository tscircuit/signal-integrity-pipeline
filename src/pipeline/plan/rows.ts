import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import {
  getPinName,
  getTraceColor,
  type PlanHeaderRow,
  type PlanTrace,
  planColors,
  type SourcePortId,
  type SourceTraceId,
} from "../../board"
import { buildConnectionGraph, findConnectionPath } from "../../simulation"
import type { PlanFault } from "./fault"
import {
  describeTrace,
  formatTotalLengthMm,
  measureTraces,
  type TraceMeasure,
} from "./measure"
import type { PlanPath } from "./visual"
import type {
  PlanPathSegment,
  PlanTopology,
  ResolvedPlanPath,
} from "./visual-topology"

/** Group the words for a count by number. */
export function formatCount({
  count,
  noun,
}: {
  count: number
  noun: string
}): string {
  if (count === 1) return `1 ${noun}`
  return `${count} ${noun}s`
}

/** Get the part record from the source pin, even without a board pad. */
export function findPinPart({
  sourcePortId,
  db,
}: {
  sourcePortId: SourcePortId
  db: CircuitJsonUtilObjects
}): ReturnType<CircuitJsonUtilObjects["source_component"]["get"]> {
  return db.source_component.get(
    db.source_port.get(sourcePortId)?.source_component_id || "",
  )
}

/** Name the series part using its component record. */
export function describeSeriesPart({
  fromSourcePortId,
  db,
}: {
  fromSourcePortId: SourcePortId
  db: CircuitJsonUtilObjects
}): string {
  const part = findPinPart({ sourcePortId: fromSourcePortId, db })
  if (!part?.name) return "part"
  if (part.ftype === "simple_resistor") return `resistor ${part.name}`
  if (part.ftype === "simple_capacitor") return `capacitor ${part.name}`
  if (part.ftype === "simple_inductor") return `inductor ${part.name}`
  return `part ${part.name}`
}

/** An orientation-independent key for one path segment. */
export function getSegmentKey(segment: PlanPathSegment): string {
  if (segment.kind === "trace") return segment.sourceTraceId
  return [
    segment.kind,
    ...[segment.fromSourcePortId, segment.toSourcePortId].sort(),
  ].join(" ")
}

/** A path segment with its on-board endpoints. */
function buildPathRow({
  legLabel,
  fromSourcePortId,
  toSourcePortId,
  detail,
  color,
  db,
}: Pick<PlanPath, "legLabel" | "fromSourcePortId" | "toSourcePortId"> & {
  detail: string
  color: string
  db: CircuitJsonUtilObjects
}): PlanHeaderRow {
  return {
    text: `${legLabel}: ${getPinName({ sourcePortId: fromSourcePortId, db })} → ${getPinName({ sourcePortId: toSourcePortId, db })} (${detail})`,
    color,
  }
}

/** Orient extra traces away from their connection to a receiver path. */
export function orderExtraTraces(topology: PlanTopology): readonly PlanTrace[] {
  const connectedSpiceNodeNames = new Set(
    topology.paths
      .flatMap(({ fromSourcePortId, toSourcePortId, pathSegments }) => [
        fromSourcePortId,
        toSourcePortId,
        ...pathSegments.flatMap((segment) => [
          segment.fromSourcePortId,
          segment.toSourcePortId,
        ]),
      ])
      .map(
        (sourcePortId) =>
          topology.spiceNodeNamesBySourceContactId[sourcePortId],
      )
      .filter((node) => node && node !== "0"),
  )
  const extras = topology.traces.filter(
    ({ isOnReceiverPath }) => !isOnReceiverPath,
  )
  const ordered: PlanTrace[] = []
  while (extras.length) {
    const attached = extras.findIndex(
      ({ fromSourcePortId, toSourcePortId }) =>
        connectedSpiceNodeNames.has(
          topology.spiceNodeNamesBySourceContactId[fromSourcePortId],
        ) ||
        connectedSpiceNodeNames.has(
          topology.spiceNodeNamesBySourceContactId[toSourcePortId],
        ),
    )
    const [trace] = extras.splice(Math.max(0, attached), 1)
    const { fromSourcePortId, toSourcePortId } = trace
    if (
      !connectedSpiceNodeNames.has(
        topology.spiceNodeNamesBySourceContactId[fromSourcePortId],
      ) &&
      connectedSpiceNodeNames.has(
        topology.spiceNodeNamesBySourceContactId[toSourcePortId],
      )
    )
      ordered.push({
        ...trace,
        fromSourcePortId: toSourcePortId,
        toSourcePortId: fromSourcePortId,
      })
    else ordered.push(trace)
    for (const sourcePortId of [fromSourcePortId, toSourcePortId]) {
      const node = topology.spiceNodeNamesBySourceContactId[sourcePortId]
      if (node && node !== "0") connectedSpiceNodeNames.add(node)
    }
  }
  return ordered
}

/** Descriptive lines for declared legs whose topology could not be built. */
function buildPartialRows({
  paths,
  fault,
  measures,
  db,
}: {
  paths: readonly PlanPath[]
  fault: PlanFault
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const graph = buildConnectionGraph(
    db.source_trace
      .list()
      .flatMap(({ source_trace_id, connected_source_port_ids }) => {
        const evidence = measures.get(source_trace_id)
        if (!evidence || connected_source_port_ids.length !== 2) return []
        const [fromVertexId, toVertexId] = connected_source_port_ids
        return [{ fromVertexId, toVertexId, evidence }]
      }),
  )
  return paths.flatMap((path) => {
    const { fromSourcePortId, toSourcePortId } = path
    if (
      fault.incompletePaths.some(
        (incomplete) =>
          incomplete.simulationPcbDriverReceiverChannelId ===
            path.simulationPcbDriverReceiverChannelId &&
          incomplete.fromSourcePortId === fromSourcePortId &&
          incomplete.toSourcePortId === toSourcePortId,
      )
    )
      return [
        buildPathRow({
          ...path,
          detail: "incomplete route",
          color: planColors.failure,
          db,
        }),
      ]
    const route = findConnectionPath({
      graph,
      fromVertexId: fromSourcePortId,
      toVertexId: toSourcePortId,
    })
    if (!route?.length) return []
    const measure = {
      lengthMm: route.reduce(
        (total, { evidence }) => total + evidence.lengthMm,
        0,
      ),
      layers: new Set(route.flatMap(({ evidence }) => [...evidence.layers])),
    }
    return [
      buildPathRow({
        ...path,
        detail: describeTrace(measure),
        color: planColors.existing,
        db,
      }),
    ]
  })
}

/** Render path segments in signal order, sharing common segments across receivers. */
function buildDetailedRows({
  topology,
  extras,
  measures,
  db,
}: {
  topology: PlanTopology
  extras: readonly PlanTrace[]
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const tracesBySourceTraceId = new Map(
    topology.traces.map((trace) => [trace.sourceTraceId, trace]),
  )
  const seen = new Set<string>()
  const rows: PlanHeaderRow[] = []
  for (const { legLabel, pathSegments } of topology.paths) {
    for (const segment of pathSegments) {
      const key = `${legLabel}: ${getSegmentKey(segment)} ${segment.fromSourcePortId}`
      if (seen.has(key)) continue
      seen.add(key)
      if (segment.kind === "trace") {
        const trace = tracesBySourceTraceId.get(segment.sourceTraceId)
        if (trace)
          rows.push(
            buildPathRow({
              ...segment,
              legLabel,
              detail: describeTrace(measures.get(segment.sourceTraceId)),
              color: getTraceColor(trace.index),
              db,
            }),
          )
      } else if (segment.kind === "series") {
        const detail = `series ${describeSeriesPart({ fromSourcePortId: segment.fromSourcePortId, db })}`
        rows.push(
          buildPathRow({
            ...segment,
            legLabel,
            detail,
            color: planColors.series,
            db,
          }),
        )
      } else {
        rows.push(
          buildPathRow({
            ...segment,
            legLabel,
            detail: "ideal connection",
            color: planColors.ideal,
            db,
          }),
        )
      }
    }
  }
  for (const trace of extras)
    rows.push(
      buildPathRow({
        ...trace,
        legLabel: "Extra trace",
        detail: describeTrace(measures.get(trace.sourceTraceId)),
        color: getTraceColor(trace.index),
        db,
      }),
    )
  return rows
}

/** Collapse a long route to one row per leg or one line for the whole board. */
function buildCompactRows({
  topology,
  extraTraceCount,
  limit,
  measures,
  db,
}: {
  topology: PlanTopology
  extraTraceCount: number
  limit: number
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  const groups = new Map<string, ResolvedPlanPath[]>()
  for (const path of topology.paths) {
    const key = JSON.stringify([
      path.simulationPcbDriverReceiverChannelId,
      path.fromSourcePortId,
    ])
    const group = groups.get(key)
    if (group) group.push(path)
    else groups.set(key, [path])
  }
  if (groups.size > limit || !groups.size) {
    const signals = new Set(
      topology.paths.map(({ channelName }) => channelName),
    )
    const sourceTraceIds = new Set(
      topology.traces.map(({ sourceTraceId }) => sourceTraceId),
    )
    return [
      {
        text: `${formatCount({ count: signals.size, noun: "signal" })} across ${formatCount({ count: sourceTraceIds.size, noun: "trace" })} (${formatTotalLengthMm({ sourceTraceIds, measures })} total).`,
      },
    ]
  }
  let suffix = ""
  if (extraTraceCount) suffix = `, +${extraTraceCount} extra`
  const indices = new Map(
    topology.traces.map(({ sourceTraceId, index }) => [sourceTraceId, index]),
  )
  return [...groups.values()].map((paths, index) => {
    const [firstPath] = paths
    const sourceTraceIds = new Set(
      paths.flatMap(({ pathSegments }) =>
        pathSegments.flatMap((segment) => {
          if (segment.kind === "trace") return [segment.sourceTraceId]
          return []
        }),
      ),
    )
    const first = indices.get([...sourceTraceIds][0])
    let color: string = planColors.ideal
    if (first !== undefined) color = getTraceColor(first)
    const driver = getPinName({ sourcePortId: firstPath.fromSourcePortId, db })
    const receivers = paths
      .map(({ toSourcePortId }) =>
        getPinName({ sourcePortId: toSourcePortId, db }),
      )
      .join(", ")
    const detail = `${formatCount({ count: sourceTraceIds.size, noun: "trace" })}, ${formatTotalLengthMm({ sourceTraceIds, measures })}`
    let text = `${firstPath.legLabel}: ${driver} → ${receivers} (${detail})`
    if (index === groups.size - 1) text += suffix
    return {
      text,
      color,
    }
  })
}

/** Keep the header legible by summarizing longer paths. */
const MAX_DETAILED_PATH_ROWS = 4

/** List the resolved route, leading with the bypass when one bypasses it. */
export function buildPathRows({
  topology,
  paths,
  fault,
  db,
}: {
  topology?: PlanTopology
  paths: readonly PlanPath[]
  fault: PlanFault
  db: CircuitJsonUtilObjects
}): PlanHeaderRow[] {
  if (!paths.length) return []
  const measures = measureTraces(db)
  if (!topology) return buildPartialRows({ paths, fault, measures, db })
  const bypassRows = fault.overlays
    .filter(({ kind }) => kind === "short")
    .map((overlay) => {
      const isReversed = paths.some(
        ({ fromSourcePortId, toSourcePortId }) =>
          overlay.toSourcePortId === fromSourcePortId &&
          overlay.fromSourcePortId === toSourcePortId,
      )
      if (isReversed)
        return buildPathRow({
          fromSourcePortId: overlay.toSourcePortId,
          toSourcePortId: overlay.fromSourcePortId,
          legLabel: "Bypass",
          detail: "ideal connection",
          color: planColors.failure,
          db,
        })
      return buildPathRow({
        ...overlay,
        legLabel: "Bypass",
        detail: "ideal connection",
        color: planColors.failure,
        db,
      })
    })
  const extras = orderExtraTraces(topology)
  const rows = buildDetailedRows({ topology, extras, measures, db })
  const limit = MAX_DETAILED_PATH_ROWS
  if (rows.length + bypassRows.length <= limit) return [...bypassRows, ...rows]
  return [
    ...bypassRows,
    ...buildCompactRows({
      topology,
      extraTraceCount: extras.length,
      limit,
      measures,
      db,
    }),
  ]
}

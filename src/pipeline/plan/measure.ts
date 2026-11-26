import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { Point } from "graphics-debug"
import type { SourceTraceId } from "../../board"

/** Board coordinates and layers for each routed source trace. */
export interface TraceMeasure {
  lengthMm: number
  layers: Set<string>
}

/** Measure the routed wire runs, including transitions through pads. */
export function measureTraces(
  db: CircuitJsonUtilObjects,
): Map<SourceTraceId, TraceMeasure> {
  const measures = new Map<SourceTraceId, TraceMeasure>()
  for (const { source_trace_id: sourceTraceId, route } of db.pcb_trace.list()) {
    if (sourceTraceId === undefined) continue
    const traceMeasure = measures.get(sourceTraceId) || {
      lengthMm: 0,
      layers: new Set<string>(),
    }
    for (const [index, point] of route.entries()) {
      if (point.route_type === "wire") traceMeasure.layers.add(point.layer)
      const previous = route[index - 1]
      if (!previous) continue
      let start: Point = previous as Point
      if (previous.route_type === "through_pad") start = previous.end
      let end: Point = point as Point
      if (point.route_type === "through_pad") end = point.start
      traceMeasure.lengthMm += Math.hypot(end.x - start.x, end.y - start.y)
    }
    measures.set(sourceTraceId, traceMeasure)
  }
  return measures
}

/** Format a board dimension with trimmed decimals. */
export function formatMillimeters(lengthMm: number): string {
  return `${Number(lengthMm.toFixed(2))} mm`
}

/** Join a route's dimensions, falling back to the route state without measurements. */
export function describeTrace(measure: TraceMeasure | undefined): string {
  if (!measure?.layers.size) return "routed"
  return `${[...measure.layers].join("/")}, ${formatMillimeters(measure.lengthMm)}`
}

/** Measure a set of trace IDs once, including when several receivers share copper. */
export function formatTotalLengthMm({
  sourceTraceIds,
  measures,
}: {
  sourceTraceIds: ReadonlySet<SourceTraceId>
  measures: ReadonlyMap<SourceTraceId, TraceMeasure>
}): string {
  let totalLengthMm = 0
  for (const sourceTraceId of sourceTraceIds)
    totalLengthMm += measures.get(sourceTraceId)?.lengthMm || 0
  return formatMillimeters(totalLengthMm)
}

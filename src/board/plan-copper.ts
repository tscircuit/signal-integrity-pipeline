import type { LayerRef, PcbTrace } from "circuit-json"
import type { Line, Point, Polygon } from "graphics-debug"
import type { PcbTraceId, SourcePortId } from "./ids"
import { buildFaultCross, getDirection, offsetPoint } from "./plan-marks"
import type { PlanPort } from "./plan-view"
import {
  getTraceColor,
  type PlanLine,
  type PlanTrace,
  type PlanVisualScene,
  planColors,
} from "./plan-visual-types"

/** A run of copper sharing a layer and width. */
interface PlanWire {
  points: Point[]
  strokeWidthMm: number
  layer: LayerRef
}

/** Break at layer or width changes while preserving connections to vias and pads. */
function extractPlanWires(trace: PcbTrace): PlanWire[] {
  const wires: PlanWire[] = []
  for (const [index, end] of trace.route.slice(1).entries()) {
    const start = trace.route[index]
    let wire = end
    if (start.route_type === "wire") wire = start
    if (wire.route_type !== "wire") continue
    let a: Point = start as Point
    if (start.route_type === "through_pad") a = start.end
    let b: Point = end as Point
    if (end.route_type === "through_pad") b = end.start
    if (a.x === b.x && a.y === b.y) continue
    const strokeWidthMm = Math.max(wire.width, wire.end_width || wire.width)
    const previous = wires.at(-1)
    const last = previous?.points.at(-1)
    if (
      previous?.layer === wire.layer &&
      previous.strokeWidthMm === strokeWidthMm &&
      last?.x === a.x &&
      last.y === a.y
    )
      previous.points.push(b)
    else wires.push({ points: [a, b], strokeWidthMm, layer: wire.layer })
  }
  return wires
}

/** Out-of-scope, nearby rail, nearby signal and selected copper have distinct styling. */
interface PlanCopperStyle {
  strokeColor: string
  label: string
  layer: string
  zIndex: number
  strokeDash?: string
}

/** Resolve per-trace scope membership once before rendering its wire runs. */
function resolveCopperStyles(
  scene: PlanVisualScene,
): Map<PcbTraceId, PlanCopperStyle> {
  const { db, copperScope, existingSourceTraceIds } = scene
  const extractedPcbTraceIds = new Set(copperScope?.extractedPcbTraceIds)
  const railPcbTraceIds = new Set(copperScope?.nearbyRailPcbTraceIds)
  const channelPcbTraceIds = new Set(copperScope?.channelPcbTraceIds)
  return new Map(
    db.pcb_trace.list().map((trace) => {
      const { pcb_trace_id: pcbTraceId, source_trace_id: sourceTraceId } = trace
      const traceLabel = sourceTraceId || pcbTraceId
      let style: PlanCopperStyle = {
        strokeColor: planColors.excluded,
        label: `Out of scope · ${traceLabel}`,
        layer: "board",
        zIndex: 0,
      }
      if (
        channelPcbTraceIds.has(pcbTraceId) ||
        (sourceTraceId !== undefined &&
          existingSourceTraceIds.has(sourceTraceId))
      )
        style = {
          strokeColor: planColors.existing,
          label: `Routed copper · ${traceLabel}`,
          layer: "traces",
          zIndex: 2,
        }
      else if (railPcbTraceIds.has(pcbTraceId))
        style = {
          strokeColor: planColors.rail,
          label: `Nearby rail · ${traceLabel}`,
          layer: "scope",
          zIndex: 1,
        }
      else if (extractedPcbTraceIds.has(pcbTraceId))
        style = {
          strokeColor: planColors.nearby,
          label: `Nearby signal · ${traceLabel}`,
          layer: "scope",
          zIndex: 1,
          strokeDash: "10,3",
        }
      else if (!copperScope && !scene.diagnostic)
        style = { ...style, label: `Board copper · ${traceLabel}` }
      return [pcbTraceId, style]
    }),
  )
}

/** A trace stroke encodes the PCB layer without relying on SVG arrow scaling. */
function buildTraceStrokes({
  wire,
  planTrace,
  label,
}: {
  wire: PlanWire
  planTrace: PlanTrace
  label: string
}): Line[] {
  const { points, strokeWidthMm, layer } = wire
  let traceStrokeWidthMm = strokeWidthMm
  if (!planTrace.isOnReceiverPath) traceStrokeWidthMm *= 0.7
  const line: Line = {
    points,
    strokeWidth: traceStrokeWidthMm,
    strokeColor: getTraceColor(planTrace.index),
    label: `${label} · ${layer}`,
    layer: "traces",
    zIndex: 2,
  }
  if (layer === "top") return [line]
  if (layer === "bottom")
    return [
      { ...line, strokeColor: "#cbd5e1", strokeWidth: strokeWidthMm },
      { ...line, strokeDash: "10,4" },
    ]
  return [
    line,
    { ...line, strokeColor: "#fff", strokeWidth: strokeWidthMm * 0.18 },
  ]
}

/** Trace ticks sit just inside the partition, away from the endpoint glyphs. */
function buildTraceTicks({
  wires,
  unitMm,
  label,
  color,
}: {
  wires: readonly PlanWire[]
  unitMm: number
  label: string
  color: string
}): Line[] {
  const first = wires[0]
  const last = wires.at(-1)
  if (!first || !last) return []
  return [
    [first.points[0], first.points[1]],
    [last.points[last.points.length - 1], last.points[last.points.length - 2]],
  ].flatMap(([from, to]) => {
    const axis = getDirection({ from, to })
    if (axis.lengthMm === 0) return []
    const point = offsetPoint({
      point: from,
      axis,
      along: Math.min(unitMm * 2.2, axis.lengthMm * 0.32),
    })
    const tickHalfWidthMm = Math.max(unitMm, first.strokeWidthMm * 0.9)
    const points = [-tickHalfWidthMm, tickHalfWidthMm].map((across) =>
      offsetPoint({ point, axis, across }),
    )
    return [
      {
        points,
        strokeWidth: unitMm * 0.62,
        strokeColor: "#fff",
        label,
        layer: "traces",
        zIndex: 3,
      },
      {
        points,
        strokeWidth: unitMm * 0.29,
        strokeColor: color,
        label,
        layer: "traces",
        zIndex: 3,
      },
    ]
  })
}

/** Space path arrowheads and suppress them on traces shorter than a glyph. */
const PATH_CHEVRON_SPACING = 8
const MIN_PATH_CHEVRON_LENGTH = 5

/** Directional chevrons spaced across each trace, independent of wire vertices. */
function buildPathChevrons({
  wires,
  from,
  unitMm,
  label,
  color,
}: {
  wires: readonly PlanWire[]
  from?: Point
  unitMm: number
  label: string
  color: string
}): Polygon[] {
  const first = wires[0]?.points[0]
  const last = wires.at(-1)?.points.at(-1)
  if (!first || !last) return []
  let isReversed = false
  if (from)
    isReversed =
      getDirection({ from, to: first }).lengthMm >
      getDirection({ from, to: last }).lengthMm
  const segments = wires.flatMap(({ points }) =>
    points.slice(1).map((to, i) => {
      const start = points[i]
      if (isReversed)
        return { start: to, axis: getDirection({ from: to, to: start }) }
      return { start, axis: getDirection({ from: start, to }) }
    }),
  )
  if (isReversed) segments.reverse()
  const total = segments.reduce(
    (length, segment) => length + segment.axis.lengthMm,
    0,
  )
  const count = Math.floor(total / (unitMm * PATH_CHEVRON_SPACING)) + 1
  if (total < unitMm * MIN_PATH_CHEVRON_LENGTH) return []
  let traversed = 0
  let next = total / (count + 1)
  const shapes: Polygon[] = []
  for (const { start, axis } of segments) {
    while (next <= traversed + axis.lengthMm && next < total - unitMm) {
      const point = offsetPoint({ point: start, axis, along: next - traversed })
      const points = [
        [-0.7, -0.68],
        [0.16, 0],
        [-0.7, 0.68],
        [-0.16, 0.68],
        [0.7, 0],
        [-0.16, -0.68],
      ].map(([along, across]) =>
        offsetPoint({
          point,
          axis,
          along: along * unitMm,
          across: across * unitMm,
        }),
      )
      shapes.push({
        points,
        fill: color,
        stroke: "#fff",
        strokeWidth: unitMm * 0.23,
        layer: "paths",
        label,
      })
      next += total / (count + 1)
    }
    traversed += axis.lengthMm
  }
  return shapes
}

/** The physical copper plus trace and path overlays. */
interface PlanCopperDrawing {
  lines: PlanLine[]
  chevrons: Polygon[]
  faults: Polygon[]
}

/** Build trace layers in copper order; diagnostic paths retain the real trace vertices. */
export function drawCopper({
  scene,
  ports,
  unitMm,
}: {
  scene: PlanVisualScene
  ports: ReadonlyMap<SourcePortId, PlanPort>
  unitMm: number
}): PlanCopperDrawing {
  const lines: PlanLine[] = []
  const chevrons: Polygon[] = []
  const faults: Polygon[] = []
  const styles = resolveCopperStyles(scene)
  const planTracesBySourceTraceId = new Map(
    scene.traces.map((planTrace) => [planTrace.sourceTraceId, planTrace]),
  )
  for (const trace of scene.db.pcb_trace.list()) {
    const { source_trace_id: sourceTraceId } = trace
    const planTrace =
      sourceTraceId && planTracesBySourceTraceId.get(sourceTraceId)
    const wires = extractPlanWires(trace)
    const style = styles.get(trace.pcb_trace_id)
    if (planTrace) {
      const label = `Trace ${planTrace.index + 1} · ${ports.get(planTrace.fromSourcePortId)?.label || planTrace.fromSourcePortId} → ${ports.get(planTrace.toSourcePortId)?.label || planTrace.toSourcePortId}`
      lines.push(
        ...wires.flatMap((wire) =>
          buildTraceStrokes({ wire, planTrace, label }),
        ),
      )
      const color = getTraceColor(planTrace.index)
      lines.push(...buildTraceTicks({ wires, unitMm, label, color }))
      if (planTrace.isOnReceiverPath)
        chevrons.push(
          ...buildPathChevrons({
            wires,
            from: ports.get(planTrace.fromSourcePortId),
            unitMm,
            label: `Receiver path · ${label}`,
            color,
          }),
        )
    } else {
      lines.push(
        ...wires.map(({ points, strokeWidthMm }) => ({
          points,
          strokeWidth: strokeWidthMm,
          ...style,
        })),
      )
    }
    if (!sourceTraceId || !scene.faultSourceTraceIds.has(sourceTraceId))
      continue
    const label = `Fault trace · ${sourceTraceId}`
    for (const { points, strokeWidthMm } of wires)
      lines.push({
        points,
        strokeColor: planColors.failure,
        strokeWidth: Math.max(strokeWidthMm, unitMm * 0.64),
        strokeDash: "6,3",
        mark: "traceFault",
        zIndex: 4,
        layer: "failure",
        label,
      })
    const middle = wires.at(Math.floor(wires.length / 2))
    if (!middle) continue
    const i = Math.floor((middle.points.length - 1) / 2)
    const from = middle.points[i]
    const axis = getDirection({ from, to: middle.points[i + 1] })
    faults.push(
      buildFaultCross({
        point: offsetPoint({ point: from, axis, along: axis.lengthMm / 2 }),
        unitMm,
        label,
      }),
    )
  }
  return { lines, chevrons, faults }
}

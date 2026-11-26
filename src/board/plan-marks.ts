import type { Line, Point, Polygon } from "graphics-debug"
import type { SourcePortId } from "./ids"
import type { PlanPort } from "./plan-view"
import {
  type PlanOverlay,
  type PlanVisualEndpoint,
  type PlanVisualScene,
  planColors,
} from "./plan-visual-types"

/** A directed segment with a perpendicular for ticks, arrowheads and fault crosses. */
interface PlanDirection {
  x: number
  y: number
  lengthMm: number
}

/** Normalize direction, with a right-facing glyph for coincident or unplaced targets. */
export function getDirection({
  from,
  to,
}: {
  from: Point
  to?: Point
}): PlanDirection {
  if (!to) return { x: 1, y: 0, lengthMm: 0 }
  const x = to.x - from.x
  const y = to.y - from.y
  const lengthMm = Math.hypot(x, y)
  if (lengthMm === 0) return { x: 1, y: 0, lengthMm }
  return { x: x / lengthMm, y: y / lengthMm, lengthMm }
}

/** Place a point relative to a directed glyph's center. */
export function offsetPoint({
  point,
  axis,
  along = 0,
  across = 0,
}: {
  point: Point
  axis: PlanDirection
  along?: number
  across?: number
}): Point {
  return {
    x: point.x + axis.x * along - axis.y * across,
    y: point.y + axis.y * along + axis.x * across,
  }
}

/** Number of vertices for each round marking. */
const RING_VERTEX_COUNT = 24

/** Board-aligned circle points used for the filled ring and its white center. */
export function buildRing({
  center,
  radiusMm,
}: {
  center: Point
  radiusMm: number
}): Point[] {
  return Array.from({ length: RING_VERTEX_COUNT }, (_, i) => {
    const angle = (i * Math.PI * 2) / RING_VERTEX_COUNT
    return {
      x: center.x + radiusMm * Math.cos(angle),
      y: center.y + radiusMm * Math.sin(angle),
    }
  })
}

/** Draw both explicit vias and inline route vias without duplicate holes. */
export function buildViaShapes({
  db,
  copperScope,
  unitMm,
}: Pick<PlanVisualScene, "db" | "copperScope"> & {
  unitMm: number
}): Polygon[] {
  const extractedPcbViaIds = new Set(copperScope?.extractedPcbViaIds)
  const boardVias = db.pcb_via.list().map((via) => ({
    ...via,
    label: `Via ${via.pcb_via_id} · ${via.layers.join("–")}`,
    isInScope: extractedPcbViaIds.has(via.pcb_via_id),
  }))
  const positions = new Set(boardVias.map(({ x, y }) => `${x},${y}`))
  const nearby = new Set(copperScope?.extractedPcbTraceIds)
  const routeVias = db.pcb_trace.list().flatMap((trace) =>
    trace.route.flatMap((point) => {
      if (point.route_type !== "via") return []
      const key = `${point.x},${point.y}`
      if (positions.has(key)) return []
      positions.add(key)
      return [
        {
          ...point,
          outer_diameter: point.outer_diameter || unitMm * 2,
          hole_diameter: point.hole_diameter || unitMm,
          isInScope: nearby.has(trace.pcb_trace_id),
          label: `Route via · ${point.from_layer}–${point.to_layer}`,
        },
      ]
    }),
  )
  return [...boardVias, ...routeVias].flatMap((via) => {
    let fill = "#64748b"
    if (via.isInScope) fill = planColors.scope
    return [
      {
        points: buildRing({ center: via, radiusMm: via.outer_diameter / 2 }),
        fill,
        stroke: "#334155",
        strokeWidth: unitMm * 0.18,
        label: via.label,
        layer: "copper",
      },
      {
        points: buildRing({ center: via, radiusMm: via.hole_diameter / 2 }),
        fill: "#fff",
        stroke: "none",
        label: via.label,
        layer: "copper",
      },
    ]
  })
}

/** A glyph radius that fits the two closest distinct active contacts. */
export function getEndpointRadiusMm({
  ports,
  unitMm,
}: {
  ports: readonly Point[]
  unitMm: number
}): number {
  let radiusMm = unitMm * 1.42
  for (const [index, from] of ports.entries())
    for (const to of ports.slice(index + 1)) {
      const { lengthMm } = getDirection({ from, to })
      if (lengthMm > 0) radiusMm = Math.min(radiusMm, lengthMm * 0.38)
    }
  return radiusMm
}

/** Triangle, white-center receiver target, or open diamond. */
export function buildEndpointShape({
  point,
  endpoint,
  radiusMm,
  ports,
}: {
  point: PlanPort
  endpoint: PlanVisualEndpoint
  radiusMm: number
  ports: ReadonlyMap<SourcePortId, PlanPort>
}): Polygon[] {
  const { kind, label, color, towardSourcePortId } = endpoint
  const layer = "endpoints"
  if (kind === "driver") {
    const axis = getDirection({
      from: point,
      to: ports.get(towardSourcePortId || ""),
    })
    const points = [
      [1, 0],
      [-0.78, 0.88],
      [-0.78, -0.88],
    ].map(([along, across]) =>
      offsetPoint({
        point,
        axis,
        along: along * radiusMm,
        across: across * radiusMm,
      }),
    )
    return [
      {
        points,
        fill: "#fff",
        stroke: "#fff",
        strokeWidth: radiusMm * 0.62,
        layer,
        label,
      },
      {
        points,
        fill: color,
        stroke: planColors.ink,
        strokeWidth: radiusMm * 0.17,
        layer,
        label,
      },
    ]
  }
  if (kind === "receiver")
    return [
      {
        points: buildRing({ center: point, radiusMm: radiusMm * 1.19 }),
        fill: "#fff",
        stroke: "none",
        layer,
        label,
      },
      {
        points: buildRing({ center: point, radiusMm: radiusMm * 0.85 }),
        fill: "#fff",
        stroke: color,
        strokeWidth: radiusMm * 0.33,
        layer,
        label,
      },
      {
        points: buildRing({ center: point, radiusMm: radiusMm * 0.23 }),
        fill: color,
        stroke: "none",
        layer,
        label,
      },
    ]
  let markerHalfWidthMm = radiusMm
  if (kind === "extraTraceEnd") markerHalfWidthMm *= 0.8
  return [
    {
      points: [
        { x: point.x + markerHalfWidthMm, y: point.y },
        { x: point.x, y: point.y + markerHalfWidthMm },
        { x: point.x - markerHalfWidthMm, y: point.y },
        { x: point.x, y: point.y - markerHalfWidthMm },
      ],
      fill: "#fff",
      stroke: color,
      strokeWidth: radiusMm * 0.25,
      layer,
      label,
    },
  ]
}

/** A contrasting cross marks the middle of a gap or implicated connection. */
export function buildFaultCross({
  point,
  unitMm,
  label,
}: {
  point: Point
  unitMm: number
  label: string
}): Polygon {
  const ends = [
    [-1, -0.65],
    [-0.65, -1],
    [0, -0.35],
    [0.65, -1],
    [1, -0.65],
    [0.35, 0],
    [1, 0.65],
    [0.65, 1],
    [0, 0.35],
    [-0.65, 1],
    [-1, 0.65],
    [-0.35, 0],
  ]
  return {
    points: ends.map(([x, y]) => ({
      x: point.x + x * unitMm,
      y: point.y + y * unitMm,
    })),
    fill: planColors.failure,
    stroke: "#fff",
    strokeWidth: unitMm * 0.22,
    label,
    layer: "failure",
  }
}

/** Raise the conceptual bypass off the physical trace between the same terminals. */
function buildBypassPoints({
  from,
  to,
  unitMm,
}: {
  from: Point
  to: Point
  unitMm: number
}): Point[] {
  const axis = getDirection({ from, to })
  const riseMm = Math.min(axis.lengthMm / 4, unitMm * 5)
  let side = 1
  if (axis.x < 0) side = -1
  return [
    from,
    offsetPoint({
      point: from,
      axis,
      along: axis.lengthMm / 2,
      across: riseMm * side,
    }),
    to,
  ]
}

/** Physical passives connect their pads through a framed body. */
export function buildOverlayShapes({
  overlay,
  from,
  to,
  unitMm,
}: {
  overlay: PlanOverlay
  from: Point
  to: Point
  unitMm: number
}): Polygon[] {
  const { kind, label } = overlay
  const axis = getDirection({ from, to })
  const point = offsetPoint({ point: from, axis, along: axis.lengthMm / 2 })
  if (kind === "short")
    return [
      buildFaultCross({
        point: buildBypassPoints({ from, to, unitMm })[1],
        unitMm,
        label,
      }),
    ]
  if (kind === "missing") return [buildFaultCross({ point, unitMm, label })]
  if (kind !== "series" || axis.lengthMm === 0) return []
  const halfLengthMm = axis.lengthMm / 2
  const points = [
    [-halfLengthMm, -unitMm],
    [halfLengthMm, -unitMm],
    [halfLengthMm, unitMm],
    [-halfLengthMm, unitMm],
  ].map(([along, across]) => offsetPoint({ point, axis, along, across }))
  return [
    {
      points,
      fill: "rgba(254,243,199,0.24)",
      stroke: planColors.series,
      strokeWidth: unitMm * 0.32,
      label,
      layer: "topology",
    },
  ]
}

/** Dashed joins, amber series bridges and red failure overlays. */
export function buildOverlayLine({
  overlay,
  from,
  to,
  unitMm,
}: {
  overlay: PlanOverlay
  from: Point
  to: Point
  unitMm: number
}): Line {
  const { kind, label } = overlay
  if (kind === "series") {
    const axis = getDirection({ from, to })
    const points = [0, 0.24, 0.37, 0.5, 0.63, 0.76, 1].map((fraction, i) =>
      offsetPoint({
        point: from,
        axis,
        along: fraction * axis.lengthMm,
        across: [0, 0, 0.52, -0.52, 0.52, 0, 0][i] * unitMm,
      }),
    )
    return {
      points,
      label,
      layer: "topology",
      strokeColor: planColors.series,
      strokeWidth: unitMm * 0.55,
      zIndex: 3,
    }
  }
  if (kind === "ideal")
    return {
      points: [from, to],
      label,
      layer: "topology",
      strokeColor: planColors.ideal,
      strokeWidth: unitMm * 0.68,
      strokeDash: "7,4",
      zIndex: 3,
    }
  let points = [from, to]
  if (kind === "short") points = buildBypassPoints({ from, to, unitMm })
  return {
    points,
    label,
    layer: "failure",
    strokeColor: planColors.failure,
    strokeWidth: unitMm * 0.63,
    strokeDash: "6,4",
    zIndex: 4,
  }
}

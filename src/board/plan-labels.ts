import {
  Point as BoardPoint,
  Polygon as BoardPolygon,
  Box,
  Segment,
} from "@flatten-js/core"
import type { Line, Point, Polygon, Text } from "graphics-debug"
import type { SourcePortId } from "./ids"
import { estimateTextWidthEms, getPlanTextSizeMm } from "./plan-header"
import {
  getBoxPoints,
  getPinName,
  getPlanPolygonOutline,
  getPointBounds,
  type PlanFrame,
  type PlanPort,
} from "./plan-view"
import {
  getTraceColor,
  type PlanPolygon,
  type PlanVisualScene,
  planColors,
  planPourFills,
} from "./plan-visual-types"

/** A name anchored to a board feature. */
type PlanLabel = {
  text: string
  color: string
  anchor: Box
} & (
  | { kind: "pin" | "part" }
  | { kind: "pour"; outline: BoardPolygon; legend: string }
)

/** Board annotations to draw above the copper. */
interface PlanLabels {
  texts: Text[]
  backgrounds: Polygon[]
  leaders: Line[]
  pourLegendEntries: string[]
}

/** Prefer the fault indication, then the endpoint marker, then the trace or overlay. */
function buildPinColors(scene: PlanVisualScene): Map<SourcePortId, string> {
  const colors = new Map<SourcePortId, string>()
  for (const { fromSourcePortId, toSourcePortId, kind } of scene.overlays) {
    let color: string = planColors.failure
    if (kind === "series" || kind === "ideal") color = planColors[kind]
    colors.set(fromSourcePortId, color)
    colors.set(toSourcePortId, color)
  }
  for (const { fromSourcePortId, toSourcePortId, index } of [
    ...scene.traces,
  ].reverse()) {
    colors.set(fromSourcePortId, getTraceColor(index))
    colors.set(toSourcePortId, getTraceColor(index))
  }
  for (const { sourcePortId, color } of scene.endpoints)
    colors.set(sourcePortId, color)
  for (const sourcePortId of scene.faultSourcePortIds)
    colors.set(sourcePortId, planColors.failure)
  return colors
}

/** Convert the projected bounds of a board mark to a collision box. */
function getMarkBox(polygon: Polygon): Box | undefined {
  const bounds = getPointBounds(polygon.points)
  if (bounds === undefined) return
  const halfStrokeMm = (polygon.strokeWidth || 0) / 2
  return new Box(
    bounds.minX - halfStrokeMm,
    bounds.minY - halfStrokeMm,
    bounds.maxX + halfStrokeMm,
    bounds.maxY + halfStrokeMm,
  )
}

/** The center of a label box supplies both its text and backing positions. */
function getLabelBox({
  x,
  y,
  widthMm,
  heightMm,
}: Point & { widthMm: number; heightMm: number }): Box {
  return new Box(
    x - widthMm / 2,
    y - heightMm / 2,
    x + widthMm / 2,
    y + heightMm / 2,
  )
}

/** Place labels against a mark first, then step outward if that space is occupied. */
function placeLabel({
  label,
  fontSizeMm,
  window,
  clearance,
}: {
  label: PlanLabel
  fontSizeMm: number
  window: Box
  clearance: LabelClearance
}): Box | undefined {
  const { anchor, text } = label
  const widthMm = (estimateTextWidthEms(text) + 0.45) * fontSizeMm
  const heightMm = fontSizeMm * 1.27
  const center = anchor.center
  if (label.kind === "pour") {
    for (const xFraction of [0.5, 0.34, 0.66, 0.25, 0.75]) {
      for (const yFraction of [0.27, 0.5, 0.73]) {
        const box = getLabelBox({
          x: anchor.xmin + anchor.width * xFraction,
          y: anchor.ymin + anchor.height * yFraction,
          widthMm,
          heightMm,
        })
        if (
          window.contains(box) &&
          label.outline.contains(new BoardPolygon(box)) &&
          isLabelBoxClear({ box, clearance })
        )
          return box
      }
    }
    return
  }
  let sides = [-1, 1]
  if (label.kind === "pin") sides = [1, -1]
  const marginMm = fontSizeMm * 0.19
  if (widthMm + marginMm * 2 < window.width) {
    const x = Math.max(
      window.xmin + widthMm / 2 + marginMm,
      Math.min(window.xmax - widthMm / 2 - marginMm, center.x),
    )
    for (let step = 0; step * fontSizeMm <= window.height; step++) {
      for (const side of sides) {
        let edge = anchor.ymin
        if (side > 0) edge = anchor.ymax
        const y = edge + side * ((step + 0.5) * heightMm + marginMm)
        for (const dx of [0, -step * fontSizeMm, step * fontSizeMm]) {
          const box = getLabelBox({ x: x + dx, y, widthMm, heightMm })
          if (window.contains(box) && isLabelBoxClear({ box, clearance }))
            return box
        }
      }
      if (label.kind === "part") {
        const gapMm = widthMm / 2 + marginMm + step * fontSizeMm
        for (const x of [anchor.xmax + gapMm, anchor.xmin - gapMm]) {
          const box = getLabelBox({ x, y: center.y, widthMm, heightMm })
          if (window.contains(box) && isLabelBoxClear({ box, clearance }))
            return box
        }
      }
    }
  }
  // A crowded crop can run out of room. Continue into the margin at full size.
  const x = window.xmax + widthMm / 2 + fontSizeMm
  for (let y = center.y; ; y -= heightMm + marginMm) {
    const box = getLabelBox({ x, y, widthMm, heightMm })
    if (isLabelBoxClear({ box, clearance })) return box
  }
}

/** Keep the leader clear of the backing and start it at the actual pin. */
function buildLabelLeader({
  label,
  box,
  fontSizeMm,
}: {
  label: PlanLabel
  box: Box
  fontSizeMm: number
}): Line | undefined {
  const { anchor, color } = label
  const from = anchor.center
  const to = new BoardPoint(
    Math.max(box.xmin, Math.min(box.xmax, from.x)),
    Math.max(box.ymin, Math.min(box.ymax, from.y)),
  )
  const gap = new Segment(from, to)
  const [edge] = gap.intersect(anchor)
  if (
    edge === undefined ||
    Math.hypot(to.x - edge.x, to.y - edge.y) <= fontSizeMm * 0.55
  )
    return
  return {
    points: [edge, to],
    strokeColor: color,
    strokeWidth: fontSizeMm * 0.075,
    layer: "labels",
  }
}

/** A labeled polygon and its projected board bounds. */
interface BoardMark {
  polygon: Polygon
  bounds: Box
}

/** Gather candidate labels in pin, part, then pour order. */
function collectPlanLabels({
  scene,
  ports,
  radiusMm,
  window,
  marks,
  bodies,
  polygons,
}: {
  scene: PlanVisualScene
  ports: ReadonlyMap<SourcePortId, PlanPort>
  radiusMm: number
  window: Box
  marks: readonly BoardMark[]
  bodies: readonly Box[]
  polygons: readonly PlanPolygon[]
}): PlanLabel[] {
  const pins = [...buildPinColors(scene)].flatMap(
    ([sourcePortId, color]): PlanLabel[] => {
      const port = ports.get(sourcePortId)
      if (
        port === undefined ||
        !window.contains(new BoardPoint(port.x, port.y))
      )
        return []
      let markerSizeMm = radiusMm * 2
      if (scene.faultSourcePortIds.has(sourcePortId))
        markerSizeMm = radiusMm * 2.5
      return [
        {
          text: getPinName({ sourcePortId, db: scene.db }),
          color,
          anchor: getLabelBox({
            ...port,
            widthMm: markerSizeMm,
            heightMm: markerSizeMm,
          }),
          kind: "pin",
        },
      ]
    },
  )
  const parts = marks.flatMap(({ polygon, bounds }): PlanLabel[] => {
    if (polygon.layer !== "parts" || !polygon.label) return []
    // A footprint inside a larger body reads as part of that body.
    if (
      bodies.some(
        (body) =>
          body.xmin < bounds.xmin &&
          body.xmax > bounds.xmax &&
          body.ymin < bounds.ymin &&
          body.ymax > bounds.ymax,
      )
    )
      return []
    return [
      {
        text: polygon.label,
        color: planColors.ink,
        anchor: bounds,
        kind: "part",
      },
    ]
  })
  const pours = polygons.flatMap((polygon): PlanLabel[] => {
    if (polygon.layer !== "pours" || !polygon.label) return []
    const outline = getPlanPolygonOutline(polygon)
    let glyph = "□"
    if (polygon.fill === planPourFills.pink) glyph = "■"
    return [
      {
        kind: "pour",
        text: polygon.label,
        color: planColors.quiet,
        anchor: outline.box,
        outline,
        legend: `${glyph} ${polygon.label}`,
      },
    ]
  })
  return [...pins, ...parts, ...pours]
}

/** Board marks and copper strokes that labels must avoid. */
interface LabelObstacles {
  marks: { polygon: Polygon; bounds: Box }[]
  bodies: Box[]
  obstacles: Box[]
  strokes: { segment: Segment; clearanceMm: number }[]
}

/** Index collision geometry before placing any labels. */
function indexLabelObstacles({
  polygons,
  lines,
}: {
  polygons: readonly PlanPolygon[]
  lines: readonly Line[]
}): LabelObstacles {
  const marks = polygons.flatMap((polygon) => {
    if (polygon.layer === "board" || polygon.layer === "pours") return []
    const bounds = getMarkBox(polygon)
    if (!bounds) return []
    return [{ polygon, bounds }]
  })
  const bodies = marks
    .filter(
      ({ polygon }) => polygon.layer === "parts" || polygon.layer === "bodies",
    )
    .map(({ bounds }) => bounds)
  const obstacles = marks
    .filter(
      ({ polygon }) => polygon.layer !== "parts" && polygon.layer !== "bodies",
    )
    .map(({ bounds }) => bounds)
  const strokes = lines.flatMap(({ points, strokeWidth }) =>
    points.slice(1).map((end, index) => ({
      segment: new Segment(
        new BoardPoint(points[index].x, points[index].y),
        new BoardPoint(end.x, end.y),
      ),
      clearanceMm: (strokeWidth || 0) / 2,
    })),
  )
  return { marks, bodies, obstacles, strokes }
}

/** Marks and strokes that a label may not cover. */
type LabelClearance = Pick<LabelObstacles, "obstacles" | "strokes">

/** Check the label box against marks and the full width of nearby strokes. */
function isLabelBoxClear({
  box,
  clearance,
}: {
  box: Box
  clearance: LabelClearance
}): boolean {
  const { obstacles, strokes } = clearance
  if (obstacles.some((obstacle) => !box.not_intersect(obstacle))) return false
  return strokes.every(({ segment, clearanceMm }) => {
    const padded = new Box(
      box.xmin - clearanceMm,
      box.ymin - clearanceMm,
      box.xmax + clearanceMm,
      box.ymax + clearanceMm,
    )
    return (
      padded.not_intersect(segment.box) ||
      (!padded.contains(segment.start) &&
        !padded.contains(segment.end) &&
        segment.intersect(padded).length === 0)
    )
  })
}

/** Lay out readable pin and component names without crossing visible marks. */
export function placePlanLabels({
  scene,
  frame,
  ports,
  radiusMm,
  polygons,
  lines,
}: {
  scene: PlanVisualScene
  frame: PlanFrame
  ports: ReadonlyMap<SourcePortId, PlanPort>
  radiusMm: number
  polygons: readonly PlanPolygon[]
  lines: readonly Line[]
}): PlanLabels {
  const { box } = frame
  const window = new Box(box.minX, box.minY, box.maxX, box.maxY)
  const fontSizeMm = getPlanTextSizeMm(frame.widthMm)
  const { marks, bodies, obstacles, strokes } = indexLabelObstacles({
    polygons,
    lines,
  })
  const candidates = collectPlanLabels({
    scene,
    ports,
    radiusMm,
    window,
    marks,
    bodies,
    polygons,
  })
  const texts: Text[] = []
  const backgrounds: Polygon[] = []
  const leaders: Line[] = []
  const namedPours = new Set<string>()
  const pourLegendEntries = new Map<string, string>()
  for (const label of candidates) {
    let labelFontSizeMm = fontSizeMm
    if (label.kind === "pour") {
      if (namedPours.has(label.text)) continue
      labelFontSizeMm = fontSizeMm * 0.86
    }
    let blocked = obstacles
    if (label.kind !== "pin") blocked = [...obstacles, ...bodies]
    const placement = placeLabel({
      label,
      fontSizeMm: labelFontSizeMm,
      window,
      clearance: { obstacles: blocked, strokes },
    })
    if (placement === undefined) {
      if (label.kind === "pour") pourLegendEntries.set(label.text, label.legend)
      continue
    }
    const { x, y } = placement.center
    const layer = `${label.kind} labels`
    if (label.kind === "pour") {
      namedPours.add(label.text)
      pourLegendEntries.delete(label.text)
    }
    texts.push({
      x,
      y,
      text: label.text,
      color: label.color,
      anchorSide: "center",
      fontSize: labelFontSizeMm,
      layer,
    })
    obstacles.push(placement)
    if (label.kind === "pin") {
      backgrounds.push({
        points: getBoxPoints({
          minX: placement.xmin,
          minY: placement.ymin,
          maxX: placement.xmax,
          maxY: placement.ymax,
        }),
        fill: "#fff",
        stroke: "none",
        layer,
      })
      const leader = buildLabelLeader({ label, box: placement, fontSizeMm })
      if (leader !== undefined) leaders.push(leader)
    }
  }
  return {
    texts,
    backgrounds,
    leaders,
    pourLegendEntries: [...pourLegendEntries.values()],
  }
}

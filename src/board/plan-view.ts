import {
  BooleanOperations,
  Box,
  Point as CopperPoint,
  Polygon as CopperPolygon,
  type Face,
  Segment,
} from "@flatten-js/core"
import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { PcbTrace } from "circuit-json"
import type { Line, Point, Viewbox } from "graphics-debug"
import type { Snapshot } from "../kernel"
import type { CopperScope } from "./geometry/scope"
import type { SourcePortId } from "./ids"
import type { PlanPolygon } from "./plan-visual-types"

/** Bounds of points, or undefined when there are none. */
export function getPointBounds(points: readonly Point[]): Viewbox | undefined {
  if (!points.length) return
  let box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  }
  for (const point of points)
    box = {
      minX: Math.min(box.minX, point.x),
      maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y),
      maxY: Math.max(box.maxY, point.y),
    }
  return box
}

/** The board's physical extent, including unscoped copper on boards without a boundary. */
/** @internal */
export function getBoardBounds(db: CircuitJsonUtilObjects): Viewbox {
  const board = db.pcb_board.getWhere({})
  if (board?.outline) {
    const outline = getPointBounds(board.outline)
    if (outline !== undefined) return outline
  }
  if (board?.width && board.height)
    return {
      minX: board.center.x - board.width / 2,
      maxX: board.center.x + board.width / 2,
      minY: board.center.y - board.height / 2,
      maxY: board.center.y + board.height / 2,
    }
  const points = [
    ...db.pcb_trace.list().flatMap(getTracePoints),
    ...db.pcb_port.list(),
    ...db.pcb_via.list(),
    ...db.pcb_smtpad.list().flatMap((pad) => {
      if (pad.shape === "polygon") return pad.points
      return [{ x: pad.x, y: pad.y }]
    }),
    ...db.pcb_plated_hole.list(),
    ...db.pcb_hole.list(),
    ...db.pcb_component.list().map(({ center }) => center),
  ]
  const positioned = getPointBounds(points)
  if (positioned !== undefined) return positioned
  // Keep the empty PCB coordinate system visible for planning errors.
  return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
}

/** The board window and its geometric scale before reserving header space. */
/** @internal */
export interface PlanFrame {
  box: Viewbox
  crop?: Box
  widthMm: number
  unitMm: number
}

/** Pad, via and through-pad contacts use the same board coordinates. */
/** @internal */
export interface PlanPort extends Point {
  sourcePortId: SourcePortId
  label: string
}

/** Placed ports indexed by their source-port IDs.
 * @internal
 */
export type PlanPorts = ReadonlyMap<SourcePortId, PlanPort>

/** Index placed signal ports and prefer a stable human-readable pin name. */
/** @internal */
export function indexPlanPorts(db: CircuitJsonUtilObjects): PlanPorts {
  const ports = new Map<SourcePortId, PlanPort>()
  const sources = new Map(
    db.source_port.list().map((port) => [port.source_port_id, port]),
  )
  const components = new Map(
    db.source_component
      .list()
      .map((component) => [component.source_component_id, component.name]),
  )
  for (const { source_port_id: sourcePortId, x, y } of db.pcb_port.list()) {
    if (ports.has(sourcePortId)) continue
    const source = sources.get(sourcePortId)
    let label = sourcePortId
    if (source) {
      const component = components.get(source.source_component_id || "")
      if (component) label = `${component}.${source.name}`
    }
    ports.set(sourcePortId, { sourcePortId, label, x, y })
  }
  return ports
}

/** Name a pin from its source records, including pins without a PCB pad. */
export function getPinName({
  sourcePortId,
  db,
}: {
  sourcePortId: SourcePortId
  db: CircuitJsonUtilObjects
}): string {
  const pin = db.source_port.get(sourcePortId)
  if (!pin) return "unknown pin"
  const part = db.source_component.get(pin.source_component_id || "")
  let pinLabel = pin.name
  const number = pinLabel.slice("pin".length)
  if (
    pinLabel.startsWith("pin") &&
    number &&
    [...number].every((digit) => "0123456789".includes(digit))
  )
    pinLabel = number
  const name = `pin ${pinLabel}`
  if (part?.name) return `${part.name} ${name}`
  return name
}

/** Include a through-pad route's two endpoints in its planar bounds. */
function getTracePoints(trace: PcbTrace): Point[] {
  return trace.route.flatMap((point) => {
    if (point.route_type === "through_pad") return [point.start, point.end]
    return [point]
  })
}

/** Corners in winding order, without a duplicate closing vertex. */
/** @internal */
export function getBoxPoints({ minX, minY, maxX, maxY }: Viewbox): Point[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
}

/** Keep narrow boards from producing unreadably wide or tall frames. */
const MAX_FRAME_ASPECT_RATIO = 2.2

/** Enlarge around the center to fit the maximum aspect ratio. */
function fitBox(box: Viewbox): Viewbox {
  const widthMm = box.maxX - box.minX
  const heightMm = box.maxY - box.minY
  const x = (box.minX + box.maxX) / 2
  const y = (box.minY + box.maxY) / 2
  const halfWidthMm =
    Math.max(widthMm, heightMm / MAX_FRAME_ASPECT_RATIO, 1) / 2
  const halfHeightMm =
    Math.max(heightMm, widthMm / MAX_FRAME_ASPECT_RATIO, 1) / 2
  return {
    minX: x - halfWidthMm,
    maxX: x + halfWidthMm,
    minY: y - halfHeightMm,
    maxY: y + halfHeightMm,
  }
}

/** Preserve a common stroke and marker scale across board sizes. */
const BOARD_WIDTH_IN_DRAWING_UNITS = 92
/** Favor a focused view when the board is substantially larger than the search envelope. */
const BOARD_TO_FOCUS_RATIO = 3

/** Use full board context on small boards and crop large boards around scoped copper. */
/** @internal */
export function buildPlanFrame({
  board,
  focus,
}: {
  board: Viewbox
  focus?: Viewbox
}): PlanFrame {
  let window = board
  const boardSpanMm = Math.max(board.maxX - board.minX, board.maxY - board.minY)
  if (
    focus &&
    boardSpanMm >
      BOARD_TO_FOCUS_RATIO *
        Math.max(focus.maxX - focus.minX, focus.maxY - focus.minY, 1)
  ) {
    window = focus
  }
  const box = fitBox(window)
  const widthMm = box.maxX - box.minX
  const frame: PlanFrame = {
    box,
    widthMm,
    unitMm: widthMm / BOARD_WIDTH_IN_DRAWING_UNITS,
  }
  if (window !== board)
    frame.crop = new Box(box.minX, box.minY, box.maxX, box.maxY)
  return frame
}

/** Expand the scope's channel copper bounds by the search gap within the board. */
/** @internal */
export function getCopperSearchBox({
  board,
  copperScope,
}: {
  board: Viewbox
  copperScope: Snapshot<CopperScope>
}): Viewbox | undefined {
  const { channelCopperBounds, nearbyGapMm } = copperScope
  if (!channelCopperBounds) return
  return {
    minX: Math.max(board.minX, channelCopperBounds.xmin - nearbyGapMm),
    maxX: Math.min(board.maxX, channelCopperBounds.xmax + nearbyGapMm),
    minY: Math.max(board.minY, channelCopperBounds.ymin - nearbyGapMm),
    maxY: Math.min(board.maxY, channelCopperBounds.ymax + nearbyGapMm),
  }
}

/** Clip a segment to the display bounds while retaining its direction. */
function clipPlanSegment({
  start,
  end,
  crop,
}: {
  start: Point
  end: Point
  crop: Box
}): Point[] {
  const segment = new Segment(
    new CopperPoint(start.x, start.y),
    new CopperPoint(end.x, end.y),
  )
  const points: Point[] = segment.intersect(crop)
  if (crop.contains(segment.start)) points.push(start)
  if (crop.contains(segment.end)) points.push(end)
  points.sort(
    (a, b) =>
      Math.hypot(a.x - start.x, a.y - start.y) -
      Math.hypot(b.x - start.x, b.y - start.y),
  )
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || (first.x === last.x && first.y === last.y)) return []
  return [first, last]
}

/** Clip strokes to the window using their actual segments. */
/** @internal */
export function clipPlanLines<Mark extends Line>({
  lines,
  crop,
}: {
  lines: Mark[]
  crop?: Box
}): Mark[] {
  if (!crop) return lines
  return lines.flatMap((line) =>
    line.points.slice(1).flatMap((end, index) => {
      const points = clipPlanSegment({ start: line.points[index], end, crop })
      if (points.length < 2) return []
      return [{ ...line, points }]
    }),
  )
}

/** Rebuild a copper polygon with the outside ring and all clearance holes. */
/** @internal */
export function getPlanPolygonOutline(polygon: PlanPolygon): CopperPolygon {
  const outline = new CopperPolygon(polygon.points.map(({ x, y }) => [x, y]))
  for (const hole of polygon.holes || [])
    outline.addFace(hole.map(({ x, y }) => new CopperPoint(x, y)))
  return outline
}

/** Clip board geometry to the window before converting it to graphics primitives. */
/** @internal */
export function clipPlanPolygons<Mark extends PlanPolygon>({
  polygons,
  crop,
}: {
  polygons: Mark[]
  crop?: Box
}): Mark[] {
  if (!crop) return polygons
  const window = new CopperPolygon(crop)
  return polygons.flatMap((polygon) => {
    const shape = getPlanPolygonOutline(polygon)
    if (crop.not_intersect(shape.box)) return []
    if (crop.contains(shape.box)) return [polygon]
    return BooleanOperations.intersect(shape, window)
      .splitToIslands()
      .map((island) => {
        const [outer, ...holes] = island.faces as Iterable<Face>
        return {
          ...polygon,
          points: outer.vertices,
          holes: holes.map((hole) => hole.vertices),
        }
      })
  })
}

import type { CircuitJsonUtilObjects } from "@tscircuit/circuit-json-util"
import type { GraphicsObject, Line, Text, Viewbox } from "graphics-debug"
import type { Snapshot } from "../kernel"
import { drawSectionLabel } from "./copper-geometry-label"
import { drawContacts, drawJoin, toBoardPoint } from "./copper-geometry-marks"
import type {
  ExtractedCopper,
  ReferencePour,
  TraceWire,
  WireSection,
} from "./copper-geometry-types"
import { getWirePoint } from "./copper-geometry-wire"
import { drawPlanPolygon } from "./plan-shapes"
import { getBoardBounds, getBoxPoints } from "./plan-view"
import { getTraceColor, planColors, planPourFills } from "./plan-visual-types"

/** Fit annotation and marker sizes to the physical board width. */
const BOARD_UNITS = 80
/** Boundary and reference annotation for one section interval. */
interface SectionMarks {
  lines: Line[]
  text?: Text
}

/** Ticks stay outside the copper so ideal joins remain visible inside it. */
function drawSectionBoundary({
  wire,
  positionMm,
  unitMm,
}: {
  wire: Snapshot<TraceWire>
  positionMm: number
  unitMm: number
}): Line[] {
  const [centerX, centerY] = getWirePoint({ wire, positionMm })
  const [x, y] = wire.direction
  const innerMm = wire.widthMm / 2 + unitMm * 0.08
  const outerMm = innerMm + unitMm * 0.5
  return [-1, 1].map((side) => ({
    points: [innerMm, outerMm].map((distanceMm) => ({
      x: centerX - y * side * distanceMm,
      y: centerY + x * side * distanceMm,
    })),
    strokeWidth: unitMm * 0.18,
    strokeColor: planColors.ink,
  }))
}

/** Draw one section with the layer and net of its reference. */
function drawSection({
  section,
  pours,
  index,
  db,
  unitMm,
}: {
  section: Snapshot<WireSection>
  pours: Snapshot<ReferencePour[]>
  index: number
  db: CircuitJsonUtilObjects
  unitMm: number
}): SectionMarks {
  const { startMm, endMm, wires, references } = section
  const color = getTraceColor(index)
  const label = references
    .map(({ layer, sourceNetId, lateralGapMm }) => {
      const name = db.source_net.get(sourceNetId)?.name || sourceNetId
      if (lateralGapMm === undefined) return `${name} (${layer})`
      return `${name} edge (${layer})`
    })
    .join(" / ")
  const lines = wires.flatMap((wire): Line[] => [
    {
      points: [startMm, endMm].map((positionMm) =>
        toBoardPoint(getWirePoint({ wire, positionMm })),
      ),
      strokeWidth: wire.widthMm,
      strokeColor: color,
      label: `${wire.layer} wire · ${label}`,
    },
    ...[startMm, endMm].flatMap((positionMm) =>
      drawSectionBoundary({ wire, positionMm, unitMm }),
    ),
  ])
  return {
    lines,
    text: drawSectionLabel({ section, pours, label, color, unitMm }),
  }
}

/** Draw the original trace as a light outline behind the modeled wire. */
function drawOriginalWires({
  db,
  pcbTraceIds,
  unitMm,
}: {
  db: CircuitJsonUtilObjects
  pcbTraceIds: ReadonlySet<TraceWire["pcbTraceId"]>
  unitMm: number
}): Line[] {
  return db.pcb_trace.list().flatMap(({ pcb_trace_id, route }): Line[] => {
    if (!pcbTraceIds.has(pcb_trace_id)) return []
    return route.flatMap((end, index): Line[] => {
      if (index === 0) return []
      const start = route[index - 1]
      if (
        start.route_type === "through_pad" ||
        end.route_type === "through_pad"
      )
        return []
      if (start.x === end.x && start.y === end.y) return []
      let widthMm = unitMm
      if (start.route_type === "wire") widthMm = start.width
      else if (end.route_type === "wire") widthMm = end.width
      return [
        {
          points: [start, end].map(({ x, y }) => ({ x, y })),
          strokeColor: planColors.excluded,
          strokeWidth: widthMm + unitMm * 0.65,
        },
      ]
    })
  })
}

/** Draw the board title, caption and outline before adding copper. */
function drawBoard({
  db,
  board,
  unitMm,
  error,
}: {
  db: CircuitJsonUtilObjects
  board: Viewbox
  unitMm: number
  error?: string
}): GraphicsObject {
  let outline = getBoxPoints(board)
  const boardOutline = db.pcb_board.getWhere({})?.outline
  if (boardOutline?.length) outline = boardOutline
  const title = "Copper geometry extraction"
  let statusColor: string = planColors.quiet
  if (error) statusColor = planColors.failure
  return {
    title,
    coordinateSystem: "cartesian",
    polygons: [
      {
        points: outline,
        stroke: planColors.excluded,
        strokeWidth: unitMm * 0.2,
        fill: "none",
      },
    ],
    texts: [
      {
        x: board.minX,
        y: board.maxY + unitMm * 3.9,
        anchorSide: "bottom_left",
        text: title,
        fontSize: unitMm * 2.7,
        color: planColors.ink,
      },
      {
        x: board.minX,
        y: board.maxY + unitMm * 1.7,
        anchorSide: "bottom_left",
        text:
          error ||
          "Ticks mark section boundaries. Circles mark pad contacts and vias. Dashes mark ideal joins.",
        fontSize: unitMm * 1.45,
        color: statusColor,
      },
    ],
  }
}

/** Draw physical reference copper, section boundaries, contacts, vias and joins. */
export function drawCopperGeometry({
  db,
  geometry,
  error,
}: {
  db: CircuitJsonUtilObjects
  geometry?: Snapshot<ExtractedCopper>
  error?: string
}): GraphicsObject {
  const board = getBoardBounds(db)
  const unitMm = (board.maxX - board.minX) / BOARD_UNITS || 0.1
  const drawing = drawBoard({ db, board, unitMm, error })
  if (!geometry) return drawing

  const sections = geometry.sections.map((section, index) =>
    drawSection({ section, pours: geometry.pours, index, db, unitMm }),
  )
  const joins = geometry.wires.flatMap((wire) => wire.joins || [])
  const pcbTraceIds = new Set(
    geometry.wires.flatMap(
      (wire) => wire.contributingPcbTraceIds || [wire.pcbTraceId],
    ),
  )
  const pours = geometry.pours.flatMap(({ polygon }) => {
    const [outer, ...holes] = polygon
    if (!outer?.length) return []
    return drawPlanPolygon({
      points: outer.map(toBoardPoint),
      holes: holes.map((ring) => ring.map(toBoardPoint)),
      fill: planPourFills.pink,
      stroke: planColors.rail,
      strokeWidth: unitMm * 0.12,
    })
  })
  return {
    ...drawing,
    polygons: [...(drawing.polygons || []), ...pours],
    lines: [
      ...drawOriginalWires({ db, pcbTraceIds, unitMm }),
      ...sections.flatMap(({ lines }) => lines),
      ...joins.flatMap((join) => drawJoin({ join, unitMm })),
    ],
    circles: drawContacts({ geometry, unitMm }),
    texts: [
      ...(drawing.texts || []),
      ...sections.flatMap(({ text }) => {
        if (text) return [text]
        return []
      }),
    ],
  }
}

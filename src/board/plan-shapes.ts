import {
  type Polygon as CopperPolygon,
  type Face,
  Segment,
} from "@flatten-js/core"
import {
  type CircuitJsonUtilObjects,
  getPlatedHolePolygon,
  getPourPolygon,
  getSmtPadPolygon,
  roundedRectangle,
} from "@tscircuit/circuit-json-util"
import type { PcbPlatedHole, PcbSmtPad } from "circuit-json"
import type { Point, Polygon, Viewbox } from "graphics-debug"
import type { SourcePortId } from "./ids"
import { getBoxPoints, type PlanPort, type PlanPorts } from "./plan-view"
import { type PlanPolygon, planPourFills } from "./plan-visual-types"

/** Board pad records of either technology. */
type PlanPad = PcbSmtPad | PcbPlatedHole

/** Reuse the native PCB outline and the owning rotation for footprint-local polygon pads. */
export function getPadOutline({
  db,
  pad,
}: {
  db: CircuitJsonUtilObjects
  pad: PlanPad
}): CopperPolygon {
  if (pad.type === "pcb_smtpad") return getSmtPadPolygon(pad)
  const component = db.pcb_component.get(pad.pcb_component_id || "")
  return getPlatedHolePolygon(pad, component?.rotation)
}

/** Sample even short arcs at multiple vertices. */
const MIN_ARC_SAMPLES = 4
/** Draw curved boundaries with this many vertices per radian. */
const ARC_SAMPLES_PER_RADIAN = 6

/** Sample arcs from geometry so circular and rounded shapes keep their outlines. */
function sampleFacePoints(face: Face): Point[] {
  return face.edges.flatMap(({ shape }) => {
    if (shape instanceof Segment) return [shape.start]
    const steps = Math.max(
      MIN_ARC_SAMPLES,
      Math.ceil(shape.sweep * ARC_SAMPLES_PER_RADIAN),
    )
    return Array.from({ length: steps }, (_, i) =>
      shape.pointAtLength((shape.length * i) / steps),
    ).filter((point) => point !== null)
  })
}

/** Outer polygon outlines for separate copper islands. */
type FacePolygons = Point[][]

/** Use the outer copper loops, keeping separate islands in separate polygons. */
function getFacePolygons(polygon: CopperPolygon): FacePolygons {
  return polygon.splitToIslands().flatMap((island) => {
    const [face] = island.faces as Iterable<Face>
    if (!face) return []
    return [sampleFacePoints(face)]
  })
}

/** Keep fills subtle since the SVG renderer draws all polygons above trace lines. */
export function buildBoardShapes({
  db,
  board,
  active,
  ports,
  unitMm,
}: {
  db: CircuitJsonUtilObjects
  board: Viewbox
  active: ReadonlySet<SourcePortId>
  ports: ReadonlyMap<SourcePortId, PlanPort>
  unitMm: number
}): PlanPolygon[] {
  const outline = db.pcb_board.getWhere({})?.outline
  let boardPoints = getBoxPoints(board)
  if (outline?.length) boardPoints = [...outline]
  const shapes: Polygon[] = [
    {
      points: boardPoints,
      fill: "rgba(248,250,252,0.16)",
      stroke: "#64748b",
      strokeWidth: unitMm * 0.6,
      layer: "board",
      label: "board",
    },
  ]
  return [
    ...shapes,
    ...buildPourShapes({ db, unitMm }),
    ...buildComponentShapes({ db, unitMm }),
    ...buildPadShapes({ db, unitMm, active, ports }),
  ]
}

/** Draw copper pours with rail-specific, translucent fills. */
function buildPourShapes({
  db,
  unitMm,
}: {
  db: CircuitJsonUtilObjects
  unitMm: number
}): PlanPolygon[] {
  const shapes: PlanPolygon[] = []
  for (const pour of db.pcb_copper_pour.list()) {
    const net = db.source_net.get(pour.source_net_id || "")
    let label = `Copper (${pour.layer})`
    if (net?.name) label = `${net.name} copper (${pour.layer})`
    let fill: string = planPourFills.gray
    if (net?.is_power === true && net.is_ground !== true)
      fill = planPourFills.pink
    for (const island of getPourPolygon(pour).splitToIslands()) {
      const [outer, ...holes] = island.faces as Iterable<Face>
      if (!outer) continue
      shapes.push({
        points: sampleFacePoints(outer),
        holes: holes.map(sampleFacePoints),
        fill,
        stroke: "#cbd5e1",
        strokeWidth: unitMm * 0.26,
        layer: "pours",
        label,
      })
    }
  }
  return shapes
}

/** Draw component bodies and carry their names into label placement. */
function buildComponentShapes({
  db,
  unitMm,
}: {
  db: CircuitJsonUtilObjects
  unitMm: number
}): Polygon[] {
  const shapes: Polygon[] = []
  const names = new Map(
    db.source_component
      .list()
      .map((component) => [component.source_component_id, component.name]),
  )
  for (const component of db.pcb_component.list()) {
    if (component.width <= 0 || component.height <= 0) continue
    const shape = roundedRectangle(
      component.center,
      component.width,
      component.height,
      0,
      component.rotation,
    )
    const name = names.get(component.source_component_id)
    let layer = "bodies"
    if (name) layer = "parts"
    shapes.push({
      points: getFacePolygons(shape).flat(),
      fill: "rgba(241,245,249,0.18)",
      stroke: "#94a3b8",
      strokeWidth: unitMm * 0.32,
      layer,
      label: name || component.pcb_component_id,
    })
  }
  return shapes
}

/** Draw the active pads and the holes within plated through contacts. */
function buildPadShapes({
  db,
  unitMm,
  active,
  ports,
}: {
  db: CircuitJsonUtilObjects
  unitMm: number
  active: ReadonlySet<SourcePortId>
  ports: PlanPorts
}): Polygon[] {
  const shapes: Polygon[] = []
  const sourcePortIdByPcbPortId = new Map(
    db.pcb_port.list().map((port) => [port.pcb_port_id, port.source_port_id]),
  )
  for (const pad of [...db.pcb_smtpad.list(), ...db.pcb_plated_hole.list()]) {
    const sourcePortId = sourcePortIdByPcbPortId.get(pad.pcb_port_id || "")
    const port = sourcePortId && ports.get(sourcePortId)
    let fill = "#cbd5e1"
    let stroke = "#94a3b8"
    if (sourcePortId && active.has(sourcePortId)) {
      fill = "#64748b"
      stroke = "#334155"
    }
    let label: string = pad.type
    if (port) label = `${port.label} (${port.sourcePortId})`
    const shape = getPadOutline({ db, pad })
    for (const island of shape.splitToIslands()) {
      const [outer, ...holes] = island.faces as Iterable<Face>
      if (!outer) continue
      shapes.push({
        points: sampleFacePoints(outer),
        fill,
        stroke,
        strokeWidth: unitMm * 0.22,
        layer: "pads",
        label,
      })
      for (const hole of holes)
        shapes.push({
          points: sampleFacePoints(hole),
          fill: "#fff",
          stroke: "none",
          layer: "pads",
        })
    }
  }
  return shapes
}

/** Flatten hole rings into a nonzero SVG fill. Retraced bridges have no fill area. */
export function drawPlanPolygon(polygon: PlanPolygon): Polygon[] {
  const { holes, ...outline } = polygon
  if (!holes?.length) return [outline]
  const anchor = outline.points[0]
  const points = [...outline.points, anchor]
  for (const hole of holes) points.push(...hole, hole[0], anchor)
  return [
    { ...outline, points, stroke: "none" },
    { ...outline, fill: "none" },
    ...holes.map((ring) => ({ ...outline, points: ring, fill: "none" })),
  ]
}

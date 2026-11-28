import { cju } from "@tscircuit/circuit-json-util"
import type { PcbBoard, PcbComponent, PcbTraceRoutePoint } from "circuit-json"
import { all_layers, type LayerRef, type Point } from "circuit-json"
import {
  type CircuitJson,
  type DielectricLayer,
  stackupFromCircuitJson,
} from "../../src/board"
import type { Snapshot } from "../../src/kernel"
import type { CopperCategory, InspectorCopper } from "./copper"

export const copperStyles: Record<
  CopperCategory,
  { color: string; opacity: number; order: number }
> = {
  far: { color: "#9ba8b6", opacity: 0.08, order: 1 },
  rail: { color: "#6597ca", opacity: 0.3, order: 2 },
  near: { color: "#ffba66", opacity: 1, order: 3 },
  selected: { color: "#59e2cd", opacity: 1, order: 4 },
}

/** A planar segment of a trace, with the width of its outgoing wire. */
export interface InspectorWire {
  shape: "wire"
  start: Point
  end: Point
  width: number
  layers: LayerRef[]
}

/** A plated barrel occupying a span in the stack. */
export interface InspectorBarrel {
  shape: "via"
  center: Point
  diameter: number
  layers: LayerRef[]
}

/** A copper region, with its exterior ring followed by its cutouts. */
export interface InspectorRegion {
  shape: "region"
  rings: readonly (readonly Point[])[]
  layers: LayerRef[]
}

export type InspectorShape = InspectorWire | InspectorBarrel | InspectorRegion

/** One scope entry and the shapes used to draw it in both views. */
export interface InspectorFeature extends InspectorCopper {
  shapes: InspectorShape[]
  layers: LayerRef[]
}

/** The board's physical outline, component bounds and aligned copper Z positions. */
export interface InspectorBoard {
  center: Point
  outline: readonly Point[]
  width: number
  height: number
  thickness: number
  layers: LayerRef[]
  layerZ: ReadonlyMap<LayerRef, number>
  dielectrics: DielectricLayer[]
  components: Snapshot<PcbComponent>[]
  blindViasAllowed: boolean
}

/** Fit both views to the board outline and use the stackup's physical copper positions. */
export function inspectorBoard(circuit: CircuitJson): InspectorBoard {
  const db = cju([...circuit])
  const board = db.pcb_board.getWhere({})
  if (!board) throw new Error("Circuit JSON needs a PCB board.")
  const outline = boardOutline(board)
  const xs = outline.map(({ x }) => x)
  const ys = outline.map(({ y }) => y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const bottom = Math.min(...ys)
  const top = Math.max(...ys)
  const layers = all_layers.slice(0, board.num_layers)
  layers.push(...layers.splice(1, 1))
  const stack = stackupFromCircuitJson(circuit)
  const centerZ =
    (stack.copperLayers[0].zMinMm + stack.copperLayers.at(-1)!.zMaxMm) / 2
  return {
    center: { x: (left + right) / 2, y: (top + bottom) / 2 },
    outline,
    width: right - left,
    height: top - bottom,
    thickness: board.thickness,
    layers,
    layerZ: new Map(
      stack.copperLayers.map((layer) => [
        layer.name as LayerRef,
        (layer.zMinMm + layer.zMaxMm) / 2 - centerZ,
      ]),
    ),
    dielectrics: stack.dielectrics.map((layer) => ({
      ...layer,
      zMinMm: layer.zMinMm - centerZ,
      zMaxMm: layer.zMaxMm - centerZ,
    })),
    components: db.pcb_component.list(),
    blindViasAllowed: board.allow_blind_and_buried_vias === true,
  }
}

/** Trace a rectangle around its center and rotate it in the board plane. */
function rectangle({
  center,
  width,
  height,
  rotation = 0,
}: {
  center: Point
  width: number
  height: number
  rotation?: number
}): Point[] {
  const radians = (rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map(({ x, y }) => ({
    x: center.x + cosine * x - sine * y,
    y: center.y + sine * x + cosine * y,
  }))
}

/** Use the board's polygon or the dimensioned rectangle. */
function boardOutline(board: Snapshot<PcbBoard>): readonly Point[] {
  if (board.outline && board.outline.length >= 3) return board.outline
  const { center, width, height } = board
  if (!width || !height) throw new Error("The PCB board has no usable outline.")
  return rectangle({ center, width, height })
}

/** Assign each trace segment to its wire layer, including approaches to a via. */
function traceShapes(route: readonly PcbTraceRoutePoint[]): InspectorWire[] {
  return route.flatMap((start, index): InspectorWire[] => {
    if (start.route_type === "through_pad") {
      return [
        {
          shape: "wire",
          start: start.start,
          end: start.end,
          width: start.width,
          layers: [start.start_layer],
        },
      ]
    }
    const end = route[index + 1]
    if (!end || end.route_type === "through_pad") return []
    if (start.x === end.x && start.y === end.y) return []
    if (start.route_type === "wire")
      return [
        {
          shape: "wire",
          start,
          end,
          width: start.width,
          layers: [start.layer],
        },
      ]
    if (end.route_type === "wire")
      return [
        { shape: "wire", start, end, width: end.width, layers: [end.layer] },
      ]
    return []
  })
}

/** Adapt physical records once for both renderers. */
function copperShapes({
  record,
  board,
}: {
  record: InspectorCopper["record"]
  board: InspectorBoard
}): InspectorShape[] {
  if (record.type === "pcb_trace") return traceShapes(record.route)
  if (record.type === "pcb_via") {
    let layers = board.layers
    if (board.blindViasAllowed) {
      const indices = record.layers.map((layer) => board.layers.indexOf(layer))
      layers = board.layers.slice(
        Math.min(...indices),
        Math.max(...indices) + 1,
      )
    }
    return [
      { shape: "via", center: record, diameter: record.outer_diameter, layers },
    ]
  }

  let rings: InspectorRegion["rings"]
  if (record.shape === "rect") rings = [rectangle(record)]
  else if (record.shape === "polygon") rings = [record.points]
  else {
    const { outer_ring, inner_rings } = record.brep_shape
    rings = [outer_ring.vertices, ...inner_rings.map((ring) => ring.vertices)]
  }
  return [{ shape: "region", rings, layers: [record.layer] }]
}

/** Keep a stable record identity across layer visibility and camera changes. */
export function inspectorFeatures({
  copper,
  board,
}: {
  copper: InspectorCopper[]
  board: InspectorBoard
}): InspectorFeature[] {
  return copper.map((item) => {
    const shapes = copperShapes({ record: item.record, board })
    const layers = new Set(shapes.flatMap((shape) => shape.layers))
    return {
      ...item,
      shapes,
      layers: board.layers.filter((layer) => layers.has(layer)),
    }
  })
}

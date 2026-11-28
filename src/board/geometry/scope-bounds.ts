import { Box } from "@flatten-js/core"
import {
  getPlatedHolePolygon,
  getSmtPadPolygon,
} from "@tscircuit/circuit-json-util"
import type {
  LayerRef,
  PcbPlatedHole,
  PcbSmtPad,
  PcbTrace,
  PcbVia,
} from "circuit-json"
import type { PcbTraceId } from "../ids"
import type { RoutedPoint } from "./types"

/** A surface-mount pad or plated hole with its copper outline. */
export type Pad = PcbSmtPad | PcbPlatedHole

/** Bounding boxes associated with one PCB trace record. */
type TraceBoxes = [pcbTraceId: PcbTraceId, boxes: CopperBox[]]

/** Extents of an axis-aligned copper bound in board millimetres. */
export interface CopperBounds {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

/** Bounds in board millimetres and the inclusive span of occupied layer indices. */
export interface CopperBox {
  xy: CopperBounds
  firstLayer: number
  lastLayer: number
}

/** Enclose all channel copper seeds in board XY. */
export function getChannelCopperBounds(
  boxes: readonly CopperBox[],
): CopperBounds | undefined {
  const [firstBox] = boxes
  if (!firstBox) return
  const bounds = { ...firstBox.xy }
  for (const { xy } of boxes) {
    bounds.xmin = Math.min(bounds.xmin, xy.xmin)
    bounds.ymin = Math.min(bounds.ymin, xy.ymin)
    bounds.xmax = Math.max(bounds.xmax, xy.xmax)
    bounds.ymax = Math.max(bounds.ymax, xy.ymax)
  }
  return bounds
}

/** Attach a planar bound to the span of copper layers occupied by the feature. */
export function copperBox({
  xy,
  occupiedLayers,
  boardLayers,
}: {
  xy: CopperBounds
  occupiedLayers: readonly LayerRef[]
  boardLayers: readonly LayerRef[]
}): CopperBox {
  const indices = occupiedLayers.map((layer) => boardLayers.indexOf(layer))
  return {
    xy,
    firstLayer: Math.min(...indices),
    lastLayer: Math.max(...indices),
  }
}

/** A tapered wire can reach either of its specified edge widths. */
function wireRadius(point: RoutedPoint): number {
  if (point.route_type === "via") return 0
  const widths = [point.width, point.end_width]
  return Math.max(...widths.filter((width) => width !== undefined)) / 2
}

/** Bound a wire by the widest radius at its endpoints and its approach and exit layers. */
function segmentBox({
  start,
  end,
  boardLayers,
}: {
  start: RoutedPoint
  end: RoutedPoint
  boardLayers: readonly LayerRef[]
}): CopperBox {
  const radius = Math.max(wireRadius(start), wireRadius(end))
  const xy = new Box(
    Math.min(start.x, end.x) - radius,
    Math.min(start.y, end.y) - radius,
    Math.max(start.x, end.x) + radius,
    Math.max(start.y, end.y) + radius,
  )
  const occupiedLayers: LayerRef[] = []
  if (end.route_type === "via") {
    occupiedLayers.push(end.from_layer)
  } else {
    occupiedLayers.push(end.layer)
    if (start.route_type === "via") occupiedLayers.push(start.to_layer)
    else occupiedLayers.push(start.layer)
  }
  return copperBox({ xy, occupiedLayers, boardLayers })
}

/** Bound wire segments. Through-pad primitives are outside the routed solver’s geometry. */
export function traceBoxes({
  trace,
  boardLayers,
}: {
  trace: PcbTrace
  boardLayers: readonly LayerRef[]
}): TraceBoxes {
  const boxes = trace.route.slice(1).flatMap((end, index) => {
    const start = trace.route[index]
    if (start.route_type === "through_pad" || end.route_type === "through_pad")
      return []
    return [segmentBox({ start, end, boardLayers })]
  })
  return [trace.pcb_trace_id, boxes]
}

/** A board without blind vias is drilled through the full stack. */
export function viaBox({
  via,
  boardLayers,
  blindViasAllowed,
}: {
  via: PcbVia
  boardLayers: readonly LayerRef[]
  blindViasAllowed: boolean
}): CopperBox {
  const radius = via.outer_diameter / 2
  const { x, y } = via
  const xy = new Box(x - radius, y - radius, x + radius, y + radius)
  let occupiedLayers = boardLayers
  if (blindViasAllowed) occupiedLayers = via.layers
  return copperBox({ xy, occupiedLayers, boardLayers })
}

/** Bound component pad copper using the same outlines as routed topology. */
export function padBox({
  pad,
  boardLayers,
}: {
  pad: Pad
  boardLayers: readonly LayerRef[]
}): CopperBox {
  if (pad.type === "pcb_smtpad")
    return copperBox({
      xy: getSmtPadPolygon(pad).box,
      occupiedLayers: [pad.layer],
      boardLayers,
    })
  const xy = getPlatedHolePolygon(pad).box
  return copperBox({ xy, occupiedLayers: pad.layers, boardLayers })
}

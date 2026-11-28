import type { PcbTrace } from "circuit-json"
import { hypotenuse } from "../kernel"
import type { CopperVia, TraceWire } from "./copper-geometry-types"
import { readCopperVia } from "./copper-geometry-vias"
import { MIN_WIRE_LENGTH_MM, projectWire } from "./copper-geometry-wire"
import { resolveTraceRoute } from "./geometry/ports"
import type { CopperPoint, RoutedPoint } from "./geometry/types"
import type { CircuitJson } from "./schema"

/** The planar conductors and vias present in a single trace. */
interface TraceWires {
  wires: TraceWire[]
  vias: CopperVia[]
}

/** A route point's copper layer on the requested side of travel. */
function getRouteLayer({
  point,
  side,
}: {
  point: RoutedPoint
  side: "from_layer" | "to_layer"
}): TraceWire["layer"] {
  if (point.route_type === "via") return point[side]
  return point.layer
}

/** Extract the planar copper between two consecutive route points. */
function extractWire({
  start,
  end,
  pcbTraceId,
  sourceTraceId,
  wireIndex,
}: {
  start: RoutedPoint
  end: RoutedPoint
} & Pick<TraceWire, "pcbTraceId" | "sourceTraceId" | "wireIndex">):
  | TraceWire
  | undefined {
  const layer = getRouteLayer({ point: start, side: "to_layer" })
  const entryLayer = getRouteLayer({ point: end, side: "from_layer" })
  if (layer !== entryLayer)
    throw new Error(`${pcbTraceId}: layer changes require explicit vias`)

  const lengthMm = hypotenuse(end.x - start.x, end.y - start.y)
  if (lengthMm < MIN_WIRE_LENGTH_MM) return undefined

  let departure = start
  if (departure.route_type === "via") departure = end
  if (departure.route_type === "via")
    throw new Error(`${pcbTraceId}: separated vias require a wire width`)
  if (departure.start_width !== undefined || departure.end_width !== undefined)
    throw new Error(
      `${pcbTraceId}: tapered routes need explicit width sections`,
    )

  const startPoint: CopperPoint = [start.x, start.y]
  const endPoint: CopperPoint = [end.x, end.y]
  return {
    pcbTraceId,
    sourceTraceId,
    wireIndex,
    layer,
    widthMm: departure.width,
    startPoint,
    endPoint,
    ...projectWire({ startPoint, endPoint, lengthMm }),
  }
}

/** Read each pair in routing order and read via positions for pad contact. */
export function extractTraceWires({
  circuit,
  trace,
  firstWireIndex,
}: {
  circuit: CircuitJson
  trace: PcbTrace
  firstWireIndex: number
}): TraceWires {
  const { pcb_trace_id: pcbTraceId, source_trace_id: sourceTraceId } = trace
  if (sourceTraceId === undefined)
    throw new Error(`${pcbTraceId}: missing source trace`)

  const wires: TraceWire[] = []
  const vias: CopperVia[] = []
  const { route, pcbViasByRouteIndex } = resolveTraceRoute({ circuit, trace })
  for (const [index, end] of route.entries()) {
    if (end.route_type === "via") {
      const physicalVia = pcbViasByRouteIndex.get(index)
      if (physicalVia) vias.push(readCopperVia(physicalVia))
      else {
        const { outer_diameter = 0 } = end
        vias.push({
          pcbTraceId,
          sourceTraceId,
          point: [end.x, end.y],
          layers: [end.from_layer, end.to_layer],
          outerDiameterMm: outer_diameter,
          holeDiameterMm: end.hole_diameter,
        })
      }
    }
    if (index === 0) continue
    const wire = extractWire({
      start: route[index - 1],
      end,
      pcbTraceId,
      sourceTraceId,
      wireIndex: firstWireIndex + wires.length,
    })
    if (wire) wires.push(wire)
  }
  return { vias, wires }
}

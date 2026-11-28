import { hypotenuse, type Snapshot } from "../kernel"
import type { TraceWire, UnitDirection } from "./copper-geometry-types"
import type { CopperPoint } from "./geometry/types"

/** Ignore zero-length copper and section boundaries already at a wire end. */
export const MIN_WIRE_LENGTH_MM = 1e-7
/** Coordinate precision in mm and component precision for direction grouping. */
const WIRE_COORDINATE_DECIMAL_PLACES = 7

/** Round longitudinal positions and direction components on the same grid. */
export function roundWireCoordinate(coordinate: number): number {
  return Number(coordinate.toFixed(WIRE_COORDINATE_DECIMAL_PLACES)) + 0
}

/** A rounded direction used to group parallel wires. */
export type DirectionKey = string

/** Write rounded components as numbers so signed zeros share a key. */
export function getDirectionKey(
  direction: Snapshot<UnitDirection>,
): DirectionKey {
  return direction.map(roundWireCoordinate).join(",")
}

/** Shortest distance from a point to a finite wire or a lone endpoint. */
export function measureChordDistanceMm({
  point,
  startPoint,
  endPoint,
}: {
  point: Snapshot<CopperPoint>
  startPoint: Snapshot<CopperPoint>
  endPoint: Snapshot<CopperPoint>
}): number {
  const dx = endPoint[0] - startPoint[0]
  const dy = endPoint[1] - startPoint[1]
  const lengthSquaredMm2 = dx * dx + dy * dy
  const offsetX = point[0] - startPoint[0]
  const offsetY = point[1] - startPoint[1]
  if (lengthSquaredMm2 === 0) return hypotenuse(offsetX, offsetY)
  const fraction = Math.max(
    0,
    Math.min(1, (offsetX * dx + offsetY * dy) / lengthSquaredMm2),
  )
  return hypotenuse(offsetX - fraction * dx, offsetY - fraction * dy)
}

/** Canonical direction and projected coordinates for a straight wire. */
type WireProjection = Pick<
  TraceWire,
  "direction" | "longitudinalMinMm" | "longitudinalMaxMm" | "lateralOffsetMm"
>

/** Project physical endpoints onto canonical longitudinal and lateral axes. */
export function projectWire({
  startPoint,
  endPoint,
  lengthMm,
}: {
  startPoint: CopperPoint
  endPoint: CopperPoint
  lengthMm: number
}): WireProjection {
  const dx = endPoint[0] - startPoint[0]
  const dy = endPoint[1] - startPoint[1]
  const directionX = roundWireCoordinate(dx / lengthMm)
  let sign = 1
  if (directionX < 0 || (directionX === 0 && dy < 0)) sign = -1
  const direction: UnitDirection = [
    (sign * dx) / lengthMm,
    (sign * dy) / lengthMm,
  ]
  const startProjectionMm =
    startPoint[0] * direction[0] + startPoint[1] * direction[1]
  const endProjectionMm =
    endPoint[0] * direction[0] + endPoint[1] * direction[1]
  return {
    direction,
    longitudinalMinMm: Math.min(startProjectionMm, endProjectionMm),
    longitudinalMaxMm: Math.max(startProjectionMm, endProjectionMm),
    lateralOffsetMm:
      -startPoint[0] * direction[1] + startPoint[1] * direction[0],
  }
}

/** Convert a longitudinal position to board coordinates on the wire centerline. */
export function getWirePoint({
  wire,
  positionMm,
}: {
  wire: Snapshot<Pick<TraceWire, "direction" | "lateralOffsetMm">>
  positionMm: number
}): CopperPoint {
  const [x, y] = wire.direction
  return [
    x * positionMm - y * wire.lateralOffsetMm,
    y * positionMm + x * wire.lateralOffsetMm,
  ]
}

/** Set of wires grouped by the gap between their lateral edges. */
export type WireGroup = TraceWire[]

/** Wire groups ordered along the lateral axis. */
type WireGroups = WireGroup[]

/** Partition laterally ordered wire intervals, tracking each group's full extent. */
export function groupWiresByGap({
  wires,
  gapMm,
}: {
  wires: readonly TraceWire[]
  gapMm: number
}): WireGroups {
  const ordered = wires.toSorted(
    (a, b) =>
      a.lateralOffsetMm - a.widthMm / 2 - (b.lateralOffsetMm - b.widthMm / 2) ||
      a.wireIndex - b.wireIndex,
  )
  const groups: WireGroups = []
  let group: WireGroup = []
  let groupMaxMm = -Infinity
  for (const wire of ordered) {
    const minMm = wire.lateralOffsetMm - wire.widthMm / 2
    if (minMm - groupMaxMm > gapMm) {
      group = []
      groups.push(group)
      groupMaxMm = -Infinity
    }
    group.push(wire)
    groupMaxMm = Math.max(groupMaxMm, wire.lateralOffsetMm + wire.widthMm / 2)
  }
  return groups
}

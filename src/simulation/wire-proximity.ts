import type { CopperPoint, TraceWire } from "../board"
import { hypotenuse, type Snapshot } from "../kernel"

type WireEndpoints = Snapshot<Pick<TraceWire, "startPoint" | "endPoint">>

/** The closest point on each wire and their separation in millimeters. */
interface ClosestWirePoints {
  firstPoint: Snapshot<CopperPoint>
  secondPoint: Snapshot<CopperPoint>
  distanceMm: number
}

/** Project a point onto a finite wire, including a wire reduced to one endpoint. */
function projectPointOntoWire({
  point,
  wire: { startPoint, endPoint },
}: {
  point: Snapshot<CopperPoint>
  wire: WireEndpoints
}): Snapshot<CopperPoint> {
  const deltaXMm = endPoint[0] - startPoint[0]
  const deltaYMm = endPoint[1] - startPoint[1]
  const lengthSquaredMm2 = deltaXMm ** 2 + deltaYMm ** 2
  if (lengthSquaredMm2 === 0) return startPoint
  const projectionMm2 =
    (point[0] - startPoint[0]) * deltaXMm +
    (point[1] - startPoint[1]) * deltaYMm
  const fraction = Math.max(0, Math.min(1, projectionMm2 / lengthSquaredMm2))
  return [
    startPoint[0] + fraction * deltaXMm,
    startPoint[1] + fraction * deltaYMm,
  ]
}

/** Find the closest points along two finite wire centerlines. */
export function findClosestWirePoints({
  firstWire,
  secondWire,
}: {
  firstWire: WireEndpoints
  secondWire: WireEndpoints
}): ClosestWirePoints {
  const { startPoint: firstStart, endPoint: firstEnd } = firstWire
  const { startPoint: secondStart, endPoint: secondEnd } = secondWire
  const firstDeltaXMm = firstEnd[0] - firstStart[0]
  const firstDeltaYMm = firstEnd[1] - firstStart[1]
  const secondDeltaXMm = secondEnd[0] - secondStart[0]
  const secondDeltaYMm = secondEnd[1] - secondStart[1]
  const determinantMm2 =
    firstDeltaXMm * secondDeltaYMm - firstDeltaYMm * secondDeltaXMm
  if (determinantMm2 !== 0) {
    const startDeltaXMm = secondStart[0] - firstStart[0]
    const startDeltaYMm = secondStart[1] - firstStart[1]
    const firstFraction =
      (startDeltaXMm * secondDeltaYMm - startDeltaYMm * secondDeltaXMm) /
      determinantMm2
    const secondFraction =
      (startDeltaXMm * firstDeltaYMm - startDeltaYMm * firstDeltaXMm) /
      determinantMm2
    if (
      firstFraction >= 0 &&
      firstFraction <= 1 &&
      secondFraction >= 0 &&
      secondFraction <= 1
    ) {
      const intersection: CopperPoint = [
        firstStart[0] + firstFraction * firstDeltaXMm,
        firstStart[1] + firstFraction * firstDeltaYMm,
      ]
      return {
        firstPoint: intersection,
        secondPoint: intersection,
        distanceMm: 0,
      }
    }
  }
  const pairs = [
    ...[firstStart, firstEnd].map(
      (firstPoint) =>
        [
          firstPoint,
          projectPointOntoWire({ point: firstPoint, wire: secondWire }),
        ] as const,
    ),
    ...[secondStart, secondEnd].map(
      (secondPoint) =>
        [
          projectPointOntoWire({ point: secondPoint, wire: firstWire }),
          secondPoint,
        ] as const,
    ),
  ]
  return pairs
    .map(([firstPoint, secondPoint]) => ({
      firstPoint,
      secondPoint,
      distanceMm: hypotenuse(
        firstPoint[0] - secondPoint[0],
        firstPoint[1] - secondPoint[1],
      ),
    }))
    .sort((first, second) => first.distanceMm - second.distanceMm)[0]
}

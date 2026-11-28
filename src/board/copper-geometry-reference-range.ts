import { Line, Point, Vector } from "@flatten-js/core"
import { getTraceSegmentPolygon } from "@tscircuit/circuit-json-util"
import type { Snapshot } from "../kernel"
import type {
  ReferencePour,
  TraceWire,
  WireSection,
} from "./copper-geometry-types"
import {
  MIN_WIRE_LENGTH_MM,
  measureChordDistanceMm,
} from "./copper-geometry-wire"
import type { CopperPoint } from "./geometry/types"

/** Limit edge references to the local neighborhood of ordinary board thicknesses. */
export const MAX_REFERENCE_EDGE_DISTANCE_MM = 2

/** The distance from the wire centerline to the copper outline, including holes. */
export function measurePourGapMm({
  point,
  pour,
}: {
  point: CopperPoint
  pour: Snapshot<ReferencePour>
}): number {
  let gapMm = Infinity
  for (const ring of pour.polygon) {
    for (const [index, startPoint] of ring.entries()) {
      const endPoint = ring[(index + 1) % ring.length]
      gapMm = Math.min(
        gapMm,
        measureChordDistanceMm({ point, startPoint, endPoint }),
      )
    }
  }
  return gapMm
}

/** An interval along a section's canonical longitudinal axis, in millimetres. */
export type LongitudinalInterval = Pick<WireSection, "startMm" | "endMm">

/** Intersect a wire's axis with the capsule of points within range of one edge. */
function getEdgeInterval({
  line,
  direction,
  startPoint,
  endPoint,
  lateralLimitMm,
}: {
  line: Line
  direction: Snapshot<TraceWire["direction"]>
  startPoint: Snapshot<CopperPoint>
  endPoint: Snapshot<CopperPoint>
  lateralLimitMm: number
}): LongitudinalInterval | undefined {
  const capsule = getTraceSegmentPolygon(
    { x: startPoint[0], y: startPoint[1] },
    { x: endPoint[0], y: endPoint[1] },
    lateralLimitMm * 2,
  )
  const positionsMm = line
    .intersect(capsule)
    .map(({ x, y }) => x * direction[0] + y * direction[1])
  if (positionsMm.length < 2) return undefined
  return { startMm: Math.min(...positionsMm), endMm: Math.max(...positionsMm) }
}

/** Ranges where a pour's edge is within the combined lateral and vertical limit. */
export function getEdgeCoverage({
  wire,
  pour,
  verticalGapMm,
}: {
  wire: Snapshot<TraceWire>
  pour: Snapshot<ReferencePour>
  verticalGapMm: number
}): LongitudinalInterval[] {
  if (verticalGapMm >= MAX_REFERENCE_EDGE_DISTANCE_MM) return []
  const lateralLimitMm = Math.sqrt(
    MAX_REFERENCE_EDGE_DISTANCE_MM ** 2 - verticalGapMm ** 2,
  )
  const [x, y] = wire.direction
  const line = new Line(new Point(...wire.startPoint), new Vector(-y, x))
  const edgeIntervals = pour.polygon
    .flatMap((ring) =>
      ring.flatMap((startPoint, index) => {
        const edgeInterval = getEdgeInterval({
          line,
          direction: wire.direction,
          startPoint,
          endPoint: ring[(index + 1) % ring.length],
          lateralLimitMm,
        })
        if (!edgeInterval) return []
        return [edgeInterval]
      }),
    )
    .sort((first, second) => first.startMm - second.startMm)
  const coverage: LongitudinalInterval[] = []
  for (const edgeInterval of edgeIntervals) {
    const previous = coverage.at(-1)
    if (
      !previous ||
      edgeInterval.startMm > previous.endMm + MIN_WIRE_LENGTH_MM
    ) {
      coverage.push(edgeInterval)
      continue
    }
    previous.endMm = Math.max(previous.endMm, edgeInterval.endMm)
  }
  return coverage
}

/** Test containment of a section interval within one continuous reference range. */
export function containsReferenceInterval({
  coverage,
  interval,
}: {
  coverage: LongitudinalInterval
  interval: LongitudinalInterval
}): boolean {
  return (
    coverage.startMm <= interval.startMm + MIN_WIRE_LENGTH_MM &&
    coverage.endMm >= interval.endMm - MIN_WIRE_LENGTH_MM
  )
}

/** Place handoffs inside overlapping coverage, returning none if a gap remains. */
export function findEdgeHandoffsMm({
  coverage,
  interval,
}: {
  coverage: LongitudinalInterval[]
  interval: LongitudinalInterval
}): number[] {
  const ordered = coverage.toSorted(
    (first, second) => first.startMm - second.startMm,
  )
  const handoffsMm: number[] = []
  let coveredToMm = interval.startMm
  let index = 0
  while (coveredToMm < interval.endMm - MIN_WIRE_LENGTH_MM) {
    let next: LongitudinalInterval | undefined
    while (
      index < ordered.length &&
      ordered[index].startMm <= coveredToMm + MIN_WIRE_LENGTH_MM
    ) {
      const candidate = ordered[index++]
      if (
        candidate.endMm <= coveredToMm ||
        (next && candidate.endMm <= next.endMm)
      )
        continue
      next = candidate
    }
    if (!next) return []
    if (coveredToMm > interval.startMm) {
      let previousMm = interval.startMm
      if (handoffsMm.length) previousMm = handoffsMm[handoffsMm.length - 1]
      handoffsMm.push((Math.max(previousMm, next.startMm) + coveredToMm) / 2)
    }
    coveredToMm = next.endMm
  }
  return handoffsMm
}

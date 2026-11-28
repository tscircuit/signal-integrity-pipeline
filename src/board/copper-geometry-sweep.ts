import type { Snapshot } from "../kernel"
import {
  findEdgeHandoffsMm,
  type LongitudinalInterval,
} from "./copper-geometry-reference-range"
import {
  findWireReferences,
  getReferenceCoverage,
} from "./copper-geometry-references"
import type {
  ExtractedCopper,
  ReferencePour,
  TraceWire,
  WireSection,
} from "./copper-geometry-types"
import {
  type DirectionKey,
  getDirectionKey,
  getWirePoint,
  groupWiresByGap,
  MIN_WIRE_LENGTH_MM,
  roundWireCoordinate,
} from "./copper-geometry-wire"
import type { CopperScope } from "./geometry/scope"

/** Ignore negligible intervals and treat adjacent boundaries within this tolerance as coincident. */
const SECTION_TOLERANCE_MM = 1e-6

type ReferenceProfileKey = string
type SectionKey = string
type SectionSweepGeometry = Pick<ExtractedCopper, "wires" | "pours" | "stackup">

/** Wires sharing the same physical reference profile along one interval. */
type SectionProfile = Pick<WireSection, "wires" | "references">

/** Collect active wires under each exact reference profile. */
function groupSectionReferences({
  geometry,
  wires,
  interval,
  copperScope,
}: {
  geometry: SectionSweepGeometry
  wires: TraceWire[]
  interval: LongitudinalInterval
  copperScope: Snapshot<CopperScope>
}): Iterable<SectionProfile> {
  const profiles = new Map<ReferenceProfileKey, SectionProfile>()
  const positionMm = (interval.startMm + interval.endMm) / 2
  for (const wire of wires) {
    if (
      wire.longitudinalMinMm > positionMm ||
      wire.longitudinalMaxMm < positionMm
    )
      continue
    const references = findWireReferences({
      geometry,
      wire,
      positionMm,
      interval,
    })
    if (!references.length) {
      if (copperScope.nearbyRailPcbTraceIds.includes(wire.pcbTraceId)) continue
      const point = getWirePoint({ wire, positionMm })
      throw new Error(
        `${wire.pcbTraceId} ${wire.layer} at ${point}: no actual reference pour`,
      )
    }
    const key = JSON.stringify(references)
    const profile = profiles.get(key)
    if (profile) profile.wires.push(wire)
    else profiles.set(key, { wires: [wire], references })
  }
  return profiles.values()
}

/** Include vertices and endpoints of collinear edges; the sweep deduplicates shared positions. */
function findSurfaceBoundariesMm({
  wire,
  pours,
}: {
  wire: TraceWire
  pours: readonly ReferencePour[]
}): number[] {
  const [x, y] = wire.direction
  const boundariesMm: number[] = []
  for (const pour of pours) {
    if (pour.layer === wire.layer) continue
    for (const ring of pour.polygon) {
      for (const [index, startPoint] of ring.entries()) {
        const endPoint = ring[(index + 1) % ring.length]
        const startOffsetMm =
          -startPoint[0] * y + startPoint[1] * x - wire.lateralOffsetMm
        const endOffsetMm =
          -endPoint[0] * y + endPoint[1] * x - wire.lateralOffsetMm
        if (Math.abs(startOffsetMm) <= MIN_WIRE_LENGTH_MM)
          boundariesMm.push(startPoint[0] * x + startPoint[1] * y)
        if (
          (startOffsetMm < 0 && endOffsetMm > 0) ||
          (startOffsetMm > 0 && endOffsetMm < 0)
        ) {
          const fraction = startOffsetMm / (startOffsetMm - endOffsetMm)
          const crossingX =
            startPoint[0] + (endPoint[0] - startPoint[0]) * fraction
          const crossingY =
            startPoint[1] + (endPoint[1] - startPoint[1]) * fraction
          boundariesMm.push(crossingX * x + crossingY * y)
        }
      }
    }
  }
  return boundariesMm.filter(
    (positionMm) =>
      positionMm > wire.longitudinalMinMm + MIN_WIRE_LENGTH_MM &&
      positionMm < wire.longitudinalMaxMm - MIN_WIRE_LENGTH_MM,
  )
}

/** Add edge handoffs only where no reference surface covers the existing interval. */
function findReferenceBoundariesMm({
  wire,
  geometry,
}: {
  wire: TraceWire
  geometry: SectionSweepGeometry
}): number[] {
  const surfaceBoundariesMm = findSurfaceBoundariesMm({
    wire,
    pours: geometry.pours,
  }).sort((first, second) => first - second)
  const positionsMm = [
    wire.longitudinalMinMm,
    ...surfaceBoundariesMm,
    wire.longitudinalMaxMm,
  ]
  const handoffsMm: number[] = []
  for (let index = 1; index < positionsMm.length; index++) {
    const startMm = positionsMm[index - 1]
    const endMm = positionsMm[index]
    if (endMm - startMm <= MIN_WIRE_LENGTH_MM) continue
    const interval = { startMm, endMm }
    if (
      findWireReferences({
        geometry,
        wire,
        positionMm: (startMm + endMm) / 2,
        interval,
      }).length
    )
      continue
    const coverage = getReferenceCoverage({ geometry, wire })
    handoffsMm.push(...findEdgeHandoffsMm({ coverage, interval }))
  }
  return [...surfaceBoundariesMm, ...handoffsMm]
}

/** Partition one parallel direction at changes in nearby copper and references. */
function sweepDirection({
  geometry,
  wires,
  copperScope,
}: {
  geometry: SectionSweepGeometry
  wires: TraceWire[]
  copperScope: Snapshot<CopperScope>
}): WireSection[] {
  const positionsMm = wires.flatMap((wire) => [
    wire.longitudinalMinMm,
    wire.longitudinalMaxMm,
    ...findReferenceBoundariesMm({ wire, geometry }),
  ])
  const boundariesMm = [...new Set(positionsMm.map(roundWireCoordinate))].sort(
    (a, b) => a - b,
  )
  const sections: WireSection[] = []
  for (let index = 1; index < boundariesMm.length; index++) {
    const startMm = boundariesMm[index - 1]
    const endMm = boundariesMm[index]
    if (endMm - startMm < SECTION_TOLERANCE_MM) continue
    for (const profile of groupSectionReferences({
      geometry,
      wires,
      interval: { startMm, endMm },
      copperScope,
    })) {
      const groups = groupWiresByGap({
        wires: profile.wires,
        gapMm: copperScope.nearbyGapMm,
      })
      for (const group of groups) {
        if (
          group.every((wire) =>
            copperScope.nearbyRailPcbTraceIds.includes(wire.pcbTraceId),
          )
        )
          continue
        sections.push({
          startMm,
          endMm,
          wires: group,
          references: profile.references,
        })
      }
    }
  }
  return sections
}

/** Join consecutive intervals whose wires and references are unchanged. */
function mergeSections(sections: WireSection[]): WireSection[] {
  const merged: WireSection[] = []
  const previousIndices = new Map<SectionKey, number>()
  for (const section of sections) {
    const key = JSON.stringify([
      section.wires.map((wire) => wire.wireIndex),
      section.references,
    ])
    const index = previousIndices.get(key)
    if (
      index !== undefined &&
      Math.abs(merged[index].endMm - section.startMm) < SECTION_TOLERANCE_MM
    ) {
      merged[index] = { ...merged[index], endMm: section.endMm }
      continue
    }
    previousIndices.set(key, merged.length)
    merged.push(section)
  }
  return merged
}

/** Section parallel signal and rail wires by their longitudinal and lateral geometry. */
export function sweepWireSections({
  geometry,
  copperScope,
}: {
  geometry: SectionSweepGeometry
  copperScope: Snapshot<CopperScope>
}): WireSection[] {
  const directions = new Map<DirectionKey, TraceWire[]>()
  for (const wire of geometry.wires) {
    const directionKey = getDirectionKey(wire.direction)
    const group = directions.get(directionKey)
    if (group) group.push(wire)
    else directions.set(directionKey, [wire])
  }
  const sections = [...directions.values()].flatMap((wires) =>
    sweepDirection({ geometry, wires, copperScope }),
  )
  return mergeSections(sections)
}

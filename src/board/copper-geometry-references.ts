import type { PolygonEdge } from "@flatten-js/core"
import { getPourPolygon } from "@tscircuit/circuit-json-util"
import type { PcbCopperPour, Ring } from "circuit-json"
import { hypotenuse, type Snapshot } from "../kernel"
import {
  containsReferenceInterval,
  getEdgeCoverage,
  type LongitudinalInterval,
  MAX_REFERENCE_EDGE_DISTANCE_MM,
  measurePourGapMm,
} from "./copper-geometry-reference-range"
import type {
  ExtractedCopper,
  ReferencePour,
  ReferenceSurface,
  TraceWire,
} from "./copper-geometry-types"
import { getWirePoint } from "./copper-geometry-wire"
import { polygonContains } from "./geometry/polygon"
import type { CopperPoint } from "./geometry/types"
import type { CopperLayer } from "./stackup"

/** One micrometre limits the polygonal approximation of curved pour boundaries. */
const POUR_CHORD_TOLERANCE_MM = 0.001

/** Tessellate a pour edge with bounded sagitta, preserving its start and axis extrema. */
function samplePourEdge(edge: PolygonEdge): CopperPoint[] {
  const shape = edge.shape
  if (!("r" in shape)) return [[shape.start.x, shape.start.y]]
  return shape.breakToFunctional().flatMap((arc) => {
    const maxAngle =
      4 *
      Math.asin(Math.min(1, Math.sqrt(POUR_CHORD_TOLERANCE_MM / (2 * arc.r))))
    const steps = Math.max(1, Math.ceil(arc.sweep / maxAngle))
    if (!Number.isFinite(steps))
      throw new Error("Reference pour has an unusable arc")
    const points: CopperPoint[] = [[arc.start.x, arc.start.y]]
    for (let index = 1; index < steps; index++) {
      const point = arc.pointAtLength((index * arc.length) / steps)
      if (point) points.push([point.x, point.y])
    }
    return points
  })
}

/** Keep shallow arcs as chords before converting bulges to ill-conditioned circle centers. */
function flattenShallowArcs(ring: Ring): Ring {
  return {
    ...ring,
    vertices: ring.vertices.map((start, index) => {
      if (start.bulge === undefined) return start
      const end = ring.vertices[(index + 1) % ring.vertices.length]
      const chordMm = hypotenuse(end.x - start.x, end.y - start.y)
      if ((Math.abs(start.bulge) * chordMm) / 2 > POUR_CHORD_TOLERANCE_MM)
        return start
      return { ...start, bulge: 0 }
    }),
  }
}

/** Normalize all Circuit JSON pour encodings using the same geometry as copper scope. */
export function normalizeReferencePour(pour: PcbCopperPour): ReferencePour[] {
  if (pour.source_net_id === undefined) return []
  let referencePour = pour
  if (pour.shape === "brep") {
    const { outer_ring, inner_rings } = pour.brep_shape
    if (outer_ring.vertices.length < 2) return []
    referencePour = {
      ...pour,
      brep_shape: {
        outer_ring: flattenShallowArcs(outer_ring),
        inner_rings: inner_rings?.map(flattenShallowArcs),
      },
    }
  }
  const outline = getPourPolygon(referencePour)
  const polygon = [...outline.faces].map((face) =>
    face.edges.flatMap(samplePourEdge),
  )
  if (!polygon[0]?.length) return []
  return [
    {
      pcbCopperPourId: pour.pcb_copper_pour_id,
      sourceNetId: pour.source_net_id,
      layer: pour.layer,
      polygon,
    },
  ]
}

/** A reference candidate with the actual distance used to select it. */
interface ReferenceCandidate {
  reference: ReferenceSurface
  distanceMm: number
}

/** An eligible reference and its position relative to the signal copper. */
interface PourSurface {
  pour: Snapshot<ReferencePour>
  reference: ReferenceSurface
  isAboveSignal: boolean
  verticalGapMm: number
}

/** Resolve the nearer face of a reference layer. */
function getReferenceSurface({
  signal,
  pour,
  layer,
}: {
  signal: Snapshot<CopperLayer>
  pour: Snapshot<ReferencePour>
  layer: Snapshot<CopperLayer>
}): PourSurface {
  const isAboveSignal = layer.zMinMm > signal.zMaxMm
  let surfaceZMm = layer.zMaxMm
  let verticalGapMm = signal.zMinMm - surfaceZMm
  if (isAboveSignal) {
    surfaceZMm = layer.zMinMm
    verticalGapMm = surfaceZMm - signal.zMaxMm
  }
  return {
    pour,
    reference: {
      pcbCopperPourId: pour.pcbCopperPourId,
      sourceNetId: pour.sourceNetId,
      layer: pour.layer,
      surfaceZMm,
    },
    isAboveSignal,
    verticalGapMm,
  }
}

/** Find the nearest reference edge when the centerline crosses no reference copper. */
function findEdgeReference({
  point,
  surfaces,
  signal,
  wire,
  interval,
}: {
  point: CopperPoint
  surfaces: PourSurface[]
  signal: Snapshot<CopperLayer>
  wire: Snapshot<TraceWire>
  interval?: LongitudinalInterval
}): ReferenceSurface[] {
  let nearest: ReferenceCandidate | undefined
  for (const surface of surfaces) {
    const { reference, pour, verticalGapMm, isAboveSignal } = surface
    const lateralGapMm = measurePourGapMm({ point, pour })
    const distanceMm = hypotenuse(verticalGapMm, lateralGapMm)
    if (distanceMm >= MAX_REFERENCE_EDGE_DISTANCE_MM) continue
    if (nearest && nearest.distanceMm <= distanceMm) continue
    if (
      interval &&
      !getEdgeCoverage({ wire, pour, verticalGapMm }).some((coverage) =>
        containsReferenceInterval({ coverage, interval }),
      )
    )
      continue
    let surfaceZMm = signal.zMinMm - distanceMm
    if (isAboveSignal) surfaceZMm = signal.zMaxMm + distanceMm
    nearest = {
      reference: { ...reference, surfaceZMm, lateralGapMm },
      distanceMm,
    }
  }
  if (!nearest) return []
  return [nearest.reference]
}

/** Stackup and pours used to locate reference surfaces. */
type ReferenceGeometry = Snapshot<Pick<ExtractedCopper, "stackup" | "pours">>

/** A wire's copper layer and the available reference surfaces on other layers. */
interface WireReferenceSurfaces {
  signal: Snapshot<CopperLayer>
  surfaces: PourSurface[]
}

/** Resolve and validate the copper layer for the wire and each eligible pour. */
function getWireReferenceSurfaces({
  geometry,
  wire,
}: {
  geometry: ReferenceGeometry
  wire: Snapshot<TraceWire>
}): WireReferenceSurfaces {
  const signal = geometry.stackup.copperLayers.find(
    (layer) => layer.name === wire.layer,
  )
  if (!signal)
    throw new Error(`${wire.pcbTraceId}: unknown copper layer ${wire.layer}`)
  const surfaces = geometry.pours.flatMap((pour) => {
    if (pour.layer === wire.layer) return []
    const layer = geometry.stackup.copperLayers.find(
      (copperLayer) => copperLayer.name === pour.layer,
    )
    if (!layer)
      throw new Error(
        `${pour.pcbCopperPourId}: unknown copper layer ${pour.layer}`,
      )
    return [getReferenceSurface({ signal, pour, layer })]
  })
  return { signal, surfaces }
}

/** Find the nearest occupied reference surface above and below the wire. */
export function findWireReferences({
  geometry,
  wire,
  positionMm,
  interval,
}: {
  geometry: ReferenceGeometry
  wire: Snapshot<TraceWire>
  positionMm: number
  interval?: LongitudinalInterval
}): ReferenceSurface[] {
  const point = getWirePoint({ wire, positionMm })
  const { signal, surfaces } = getWireReferenceSurfaces({ geometry, wire })
  let above: PourSurface | undefined
  let below: PourSurface | undefined
  for (const surface of surfaces) {
    if (!polygonContains({ point, polygon: surface.pour.polygon })) continue
    if (surface.isAboveSignal) {
      if (!above || surface.verticalGapMm < above.verticalGapMm) above = surface
    } else if (!below || surface.verticalGapMm < below.verticalGapMm) {
      below = surface
    }
  }
  const occupied: ReferenceSurface[] = []
  if (below) occupied.push(below.reference)
  if (above) occupied.push(above.reference)
  if (occupied.length) return occupied
  return findEdgeReference({ point, surfaces, signal, wire, interval })
}

/** The intervals within range of at least one of the wire's reference edges. */
export function getReferenceCoverage({
  geometry,
  wire,
}: {
  geometry: ReferenceGeometry
  wire: Snapshot<TraceWire>
}): LongitudinalInterval[] {
  const { surfaces } = getWireReferenceSurfaces({ geometry, wire })
  return surfaces.flatMap(({ pour, verticalGapMm }) =>
    getEdgeCoverage({ wire, pour, verticalGapMm }),
  )
}

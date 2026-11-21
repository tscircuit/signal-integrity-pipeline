import type { CopperScope, RouteWire, RouteXY, SectionGeometry } from "../board"
import {
  closestRoutePoints,
  type ExtractedRoutes,
  type RouteMaterials,
  routeCrossSection,
  solveSectionCapacitance,
} from "../extraction"
import type { RouteLadder } from "./route-ladder"

/** Serialized cross-section geometry used to reuse capacitance solves. */
type CrossSectionKey = string

/** Tolerance for locating contacts on the extracted geometry (mm). */
const CONTACT_TOLERANCE = 1e-6
/** Ignore pairs whose angle sine is effectively zero. */
const MIN_ANGLE_SINE = 1e-6
/** Allow one picometre when testing whether a plane intersects a conductor (mm). */
const PLANE_TOLERANCE = 1e-9
/** Ignore corrections below this capacitance (F). */
const MIN_OBLIQUE_CAPACITANCE = 1e-23
/** Micrometres per millimetre, used to round gaps outward. */
const MICROMETRES_PER_MM = 1000
/** Millimetres in a metre, for converting the integration length. */
const MM_PER_METRE = 1000
/** Panel count used when the route does not specify a field resolution. */
const DEFAULT_OBLIQUE_PANELS = 12
/** The approximation estimates coupling on the same or adjacent copper layers only. */
const MAX_OBLIQUE_LAYER_DISTANCE = 1

/** An electrical ladder node and its distance from the requested position in millimetres. */
type NearestRouteNode = {
  node: string
  errorMm: number
}

/** Nearest existing electrical ladder node; the spatial-error distance is recorded per encounter. */
function nearestRouteNode({
  wire,
  point,
  wireNodes,
}: {
  wire: RouteWire
  point: RouteXY
  wireNodes: RouteLadder["wireNodes"]
}): NearestRouteNode {
  const position = point[0] * wire.u[0] + point[1] * wire.u[1]
  const nodes = [...wireNodes.get(wire.id)!]
  const node = nodes.sort(
    (a, b) => Math.abs(a.position - position) - Math.abs(b.position - position),
  )[0]
  return { node: node.node, errorMm: Math.abs(node.position - position) }
}

/** Report one pair of wires considered by the oblique approximation. */
interface ObliqueEncounter {
  wires: [RouteWire["id"], RouteWire["id"]]
  policy: string
  distanceMm: number
  references?: ExtractedRoutes["slices"][number]["references"]
  angleSine?: number
  lengthMm?: number
  capacitanceF?: number
  nodePlacementErrorMm?: [first: number, second: number]
}

/** SPICE lines, encounter records and solve statistics for oblique route coupling. */
type ObliqueRouteCorrection = {
  lines: string[]
  records: ObliqueEncounter[]
  solveMilliseconds: number
  solves: number
}

/** Bounded weak-coupling electrostatic correction for oblique encounters; no silent angular rejection. */
export function routeOblique({
  geometry,
  extracted,
  ladder,
  scope,
  materials,
  panels = DEFAULT_OBLIQUE_PANELS,
}: {
  geometry: SectionGeometry
  extracted: ExtractedRoutes
  ladder: RouteLadder
  scope: CopperScope
  materials: RouteMaterials
  panels?: number
}): ObliqueRouteCorrection {
  const lines: string[] = []
  const records: ObliqueEncounter[] = []
  const cache = new Map<CrossSectionKey, number>()
  let solveMilliseconds = 0
  const active = geometry.wires.filter((wire) => ladder.wireNodes.has(wire.id))
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      if (a.source === b.source) continue
      const selected = scope.selectedPcbTraceIds
      if (!selected.includes(a.trace) && !selected.includes(b.trace)) continue
      const sine = Math.abs(a.u[0] * b.u[1] - a.u[1] * b.u[0])
      if (sine < MIN_ANGLE_SINE) continue
      const near = closestRoutePoints({ first: a, second: b })
      if (near.distance - (a.width + b.width) / 2 > scope.lateralDistanceMm)
        continue
      const layers = geometry.stack.copperLayers
      const la = layers.findIndex((layer) => layer.name === a.layer)
      const lb = layers.findIndex((layer) => layer.name === b.layer)
      if (Math.abs(la - lb) > MAX_OBLIQUE_LAYER_DISTANCE) continue
      const position = near.first[0] * a.u[0] + near.first[1] * a.u[1]
      const slice = extracted.slices.find((slice) => {
        const inSlice =
          position >= slice.start - CONTACT_TOLERANCE &&
          position <= slice.end + CONTACT_TOLERANCE
        return inSlice && slice.wires.some((wire) => wire.id === a.id)
      })
      if (!slice) continue
      if (
        a.layer === b.layer &&
        near.distance < (a.width + b.width) / 2 + CONTACT_TOLERANCE
      ) {
        records.push({
          wires: [a.id, b.id],
          policy:
            "touching endpoint/bend copper: no parallel-strip substitution",
          distanceMm: near.distance,
        })
        continue
      }
      const synthetic = {
        ...slice,
        wires: [
          { ...a, transverse: 0 },
          { ...b, transverse: near.distance },
        ],
      }
      const section = routeCrossSection({
        geometry,
        slice: synthetic,
        materials,
      })
      const shielded = section.conductors.some((conductor) => {
        const bottom = conductor.zMm - PLANE_TOLERANCE
        const top = conductor.zMm + conductor.thicknessMm + PLANE_TOLERANCE
        return section.planes.some(
          (plane) => plane.zMm >= bottom && plane.zMm <= top,
        )
      })
      if (shielded) {
        records.push({
          wires: [a.id, b.id],
          policy:
            "intervening local reference shields oblique surrogate; finite plane-edge/aperture fringing omitted",
          references: slice.references,
          distanceMm: near.distance,
        })
        continue
      }
      // Quantisation is explicit and limited to 1 um transverse spacing, below route-file precision.
      section.conductors[1].xMm =
        Math.ceil(section.conductors[1].xMm * MICROMETRES_PER_MM) /
        MICROMETRES_PER_MM
      const key = JSON.stringify(section)
      let capacitancePerM = cache.get(key)
      if (capacitancePerM === undefined) {
        const start = performance.now()
        try {
          capacitancePerM = Math.max(
            0,
            -solveSectionCapacitance({
              section,
              options: { panelsPerEdge: panels },
            })[0][1],
          )
        } catch (error) {
          throw Object.assign(error as Error, {
            routeSection: section,
            wires: [a, b],
            obliqueSolves: cache.size,
            solveMilliseconds,
          })
        }
        solveMilliseconds += performance.now() - start
        cache.set(key, capacitancePerM)
      }
      const layerHeight = (layers[la].zMaxMm + layers[la].zMinMm) / 2
      const referenceGap = Math.min(
        ...slice.references.map((ref) => Math.abs(ref.z - layerHeight)),
      )
      const lengthMm = Math.min(
        a.end - a.start,
        b.end - b.start,
        (2 * referenceGap) / sine,
      )
      const first = nearestRouteNode({
        wire: a,
        point: near.first,
        wireNodes: ladder.wireNodes,
      })
      const second = nearestRouteNode({
        wire: b,
        point: near.second,
        wireNodes: ladder.wireNodes,
      })
      const capacitanceF = (capacitancePerM * lengthMm) / MM_PER_METRE
      if (
        first.node !== second.node &&
        capacitanceF > MIN_OBLIQUE_CAPACITANCE
      ) {
        lines.push(
          `COB${records.length} ${first.node} ${second.node} ${capacitanceF}`,
        )
      }
      records.push({
        wires: [a.id, b.id],
        policy: "local parallel electrostatic surrogate; magnetic term omitted",
        angleSine: sine,
        distanceMm: near.distance,
        lengthMm,
        capacitanceF,
        nodePlacementErrorMm: [first.errorMm, second.errorMm],
      })
    }
  }
  return {
    lines,
    records,
    solveMilliseconds,
    solves: cache.size,
  }
}

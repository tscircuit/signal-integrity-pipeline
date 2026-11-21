import type { RouteSlice, RouteWire, RouteXY, SectionGeometry } from "../board"
import { hypotenuse } from "../kernel"
import { sectionInverse } from "./cross-section-matrix"
import type { CrossSection, CrossSectionResult } from "./cross-section-types"
import { multiply, transpose } from "./linalg"
import type { RouteCoupling } from "./route-coupling"

/** Accept coordinate roundoff when clipping or replacing stackup layers. */
const LAYER_TOLERANCE_MM = 1e-9

/** Round transverse offsets for stable field-cache keys. */
const OFFSET_DECIMAL_PLACES = 7

/** A canonical section key and the coefficients solved for that section. */
export type SolvedRouteSection = {
  key: string
  line: RouteCoefficients
}

/** A route slice with its canonical field coefficients. */
export interface ExtractedRouteSlice extends RouteSlice, SolvedRouteSection {}
/** Solved slices, unique field sections, and extraction evidence. */
export interface ExtractedRoutes {
  slices: ExtractedRouteSlice[]
  sections: SolvedRouteSection[]
  materials: RouteMaterials
  warnings: string[]
  coupling: RouteCoupling[]
}
/** Laminate loss and soldermask thickness and dielectric properties. */
export interface RouteMaterials {
  maskMm: number
  maskEr: number
  maskLoss: number
  substrateLoss: number
}
/** Per-unit-length field coefficients for a routed section. */
export type RouteCoefficients = CrossSectionResult

/** Stackup, slice, and materials used to form one field section. */
interface RouteCrossSectionInput {
  geometry: SectionGeometry
  slice: RouteSlice
  materials: RouteMaterials
}

/** Material slabs fill absent copper layers with the nearest laminate (rather than fictitious air gaps). */
function routeDielectrics({
  geometry,
  slice,
  materials,
}: RouteCrossSectionInput): CrossSection["dielectrics"] {
  const { copperLayers, dielectrics: layers } = geometry.stack
  const bottom = Math.min(...copperLayers.map((layer) => layer.zMinMm))
  const top = Math.max(...copperLayers.map((layer) => layer.zMaxMm))
  const interfaces = layers.flatMap((layer) => [layer.zMinMm, layer.zMaxMm])
  const boundaries = [...new Set([bottom, top, ...interfaces])].sort(
    (a, b) => a - b,
  )
  const dielectrics = boundaries.slice(1).map((z, i) => {
    const middle = (boundaries[i] + z) / 2
    const [nearest] = [...layers].sort((a, b) => {
      const distanceA = Math.abs((a.zMinMm + a.zMaxMm) / 2 - middle)
      const distanceB = Math.abs((b.zMinMm + b.zMaxMm) / 2 - middle)
      return distanceA - distanceB
    })
    return {
      zMm: boundaries[i],
      thicknessMm: z - boundaries[i],
      er: nearest.relativePermittivity!,
      lossTangent: materials.substrateLoss,
    }
  })

  let lower = -Infinity
  let upper = Infinity
  if (slice.references.length > 1) {
    const heights = slice.references.map((plane) => plane.z)
    lower = Math.min(...heights)
    upper = Math.max(...heights)
  }
  const clipped = dielectrics.filter((layer) => {
    return (
      layer.zMm >= lower - LAYER_TOLERANCE_MM &&
      layer.zMm + layer.thicknessMm <= upper + LAYER_TOLERANCE_MM
    )
  })
  addOuterMask({ geometry, slice, materials, clipped })
  return clipped
}

/** Planar mask occupies gaps between outer traces and the overcoat over those traces. */
function addOuterMask({
  geometry,
  slice,
  materials,
  clipped,
}: RouteCrossSectionInput & {
  clipped: CrossSection["dielectrics"]
}): void {
  const layers = geometry.stack.copperLayers
  if (slice.wires.some((wire) => wire.layer === "top")) {
    const copper = layers.find((layer) => layer.name === "top")!
    const first = clipped.findIndex(
      (layer) => layer.zMm >= copper.zMinMm - LAYER_TOLERANCE_MM,
    )
    if (first >= 0) clipped.splice(first)
    clipped.push({
      zMm: copper.zMinMm,
      thicknessMm: copper.zMaxMm - copper.zMinMm + materials.maskMm,
      er: materials.maskEr,
      lossTangent: materials.maskLoss,
    })
  }
  if (!slice.wires.some((wire) => wire.layer === "bottom")) return
  const copper = layers.find((layer) => layer.name === "bottom")!
  const last = clipped.findIndex(
    (layer) => layer.zMm >= copper.zMaxMm - LAYER_TOLERANCE_MM,
  )
  clipped.splice(0, Math.max(0, last))
  clipped.unshift({
    zMm: copper.zMinMm - materials.maskMm,
    thicknessMm: copper.zMaxMm - copper.zMinMm + materials.maskMm,
    er: materials.maskEr,
    lossTangent: materials.maskLoss,
  })
}

/** Build the conductor, reference and material geometry seen by the cross-section solver. */
export function routeCrossSection(input: RouteCrossSectionInput): CrossSection {
  const { geometry, slice } = input
  const dielectrics = routeDielectrics(input)
  const layers = geometry.stack.copperLayers
  const offset = slice.wires[0].transverse
  const conductors = slice.wires.map((wire, i) => {
    const layer = layers.find((layer) => layer.name === wire.layer)!
    return {
      id: String(i),
      xMm: Number((wire.transverse - offset).toFixed(OFFSET_DECIMAL_PLACES)),
      zMm: layer.zMinMm,
      widthMm: wire.width,
      thicknessMm: layer.zMaxMm - layer.zMinMm,
    }
  })
  const planes = slice.references.map((plane) => ({ zMm: plane.z }))
  return { conductors, planes, dielectrics }
}

/** The two board coordinates that bound a straight route wire. */
type RouteEndpoints = Pick<RouteWire, "a" | "b">

/** Closest point on each centre-line and the distance between them. */
interface ClosestRoutePoints {
  first: RouteXY
  second: RouteXY
  distance: number
}

/** Closest points on two finite centre-lines, used only for the explicit oblique correction. */
export function closestRoutePoints({
  first: { a, b },
  second: { a: c, b: d },
}: {
  first: RouteEndpoints
  second: RouteEndpoints
}): ClosestRoutePoints {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const vx = d[0] - c[0]
  const vy = d[1] - c[1]
  const denominator = ux * vy - uy * vx
  let t = -1
  let s = -1
  if (denominator) {
    t = ((c[0] - a[0]) * vy - (c[1] - a[1]) * vx) / denominator
    s = ((c[0] - a[0]) * uy - (c[1] - a[1]) * ux) / denominator
  }
  if (t >= 0 && t <= 1 && s >= 0 && s <= 1) {
    const point: RouteXY = [a[0] + t * ux, a[1] + t * uy]
    return { first: point, second: point, distance: 0 }
  }
  const pairs = [
    [a, c, d, false],
    [b, c, d, false],
    [c, a, b, true],
    [d, a, b, true],
  ] as const
  return pairs
    .map(([point, start, end, reverse]) => {
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const projection = (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
      const fraction = Math.max(
        0,
        Math.min(1, projection / (dx * dx + dy * dy)),
      )
      const near: RouteXY = [start[0] + fraction * dx, start[1] + fraction * dy]
      const distance = hypotenuse(point[0] - near[0], point[1] - near[1])
      if (reverse) return { first: near, second: point, distance }
      return { first: point, second: near, distance }
    })
    .sort((a, b) => a.distance - b.distance)[0]
}

/** Inductance and skin-resistance matrices with the AC rail currents accounted for. */
type ReferenceSeries = Pick<
  RouteCoefficients,
  "L" | "skinResistance" | "stripSkinResistance"
>

/** Ideal AC rail voltages require induced return currents, rather than open series conductors. */
export function referenceSeries({
  line,
  grounded,
}: {
  line: RouteCoefficients
  grounded: number[]
}): ReferenceSeries {
  if (!grounded.length) return line
  const size = line.L.length
  const active = Array.from({ length: size }, (_, i) => i).filter(
    (i) => !grounded.includes(i),
  )
  const inverse = sectionInverse(
    grounded.map((i) => grounded.map((j) => line.L[i][j])),
  )
  const current = line.L.map((row, i) =>
    row.map((_, j) => Number(i === j && !grounded.includes(i))),
  )
  for (const [i, row] of grounded.entries()) {
    for (const column of active) {
      current[row][column] = -grounded.reduce(
        (sum, index, j) => sum + inverse[i][j] * line.L[index][column],
        0,
      )
    }
  }
  const projection = transpose(current)
  return {
    L: multiply({ a: projection, b: multiply({ a: line.L, b: current }) }),
    skinResistance: multiply({
      a: projection,
      b: multiply({ a: line.skinResistance, b: current }),
    }),
    stripSkinResistance: multiply({
      a: projection,
      b: multiply({ a: line.stripSkinResistance, b: current }),
    }),
  }
}

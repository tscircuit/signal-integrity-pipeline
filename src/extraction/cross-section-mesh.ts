import { hypotenuse } from "../kernel"
import {
  type CrossSection,
  copperConductivity,
  type SectionConductor,
  type SectionDielectric,
  type SectionMeshInput,
  type SectionPanel,
  type SectionRegion,
} from "./cross-section-types"
import { fail } from "./diagnostics"

/** Ignore sub-femtometer differences between slab boundaries after projection or clipping, in millimeters. */
const SLAB_TOLERANCE_MM = 1e-12

/** Sample just inside each material relative to the smallest feature in the cross-section. */
const MATERIAL_PROBE_FRACTION = 1e-7

/** Merge mesh coordinates at a tighter tolerance than the material probe offset. */
const COORDINATE_TOLERANCE_DIVISOR = 100

/** Grade panels toward the ends of each edge with a quartic distribution. */
const PANEL_GRADING_POWER = 4

/** Start increasing panel count at six plane distances of horizontal conductor face. */
const FACE_LENGTH_IN_PLANE_DISTANCES = 6

/** Mesh a short vertical face at roughly one third of the horizontal panel count. */
const VERTICAL_PANEL_DIVISOR = 3

/** Keep at least four panels on a vertical edge to resolve its corners. */
const MIN_VERTICAL_PANELS = 4

/** Negative group marks a dielectric interface row instead of a conductor excitation. */
const DIELECTRIC_GROUP = -1

/** Relative permittivity and loss tangent of the material at a boundary. */
type SectionMaterial = Pick<SectionDielectric, "er" | "lossTangent">

/** Material adjacent to a boundary; non-overlapping slabs leave air elsewhere. */
function material({
  layers,
  z,
}: {
  layers: SectionDielectric[]
  z: number
}): SectionMaterial {
  return (
    layers.find(
      (layer) => z > layer.zMm && z < layer.zMm + layer.thicknessMm,
    ) ?? { er: 1, lossTangent: 0 }
  )
}

/** Merge floating-point copies of one boundary before making panels; never create zero-size seams. */
function coordinates({
  values,
  tolerance,
}: {
  values: number[]
  tolerance: number
}): number[] {
  return values
    .sort((a, b) => a - b)
    .filter((value, i, sorted) => !i || value - sorted[i - 1] > tolerance)
}

/** A shielded region and its conductor indices in the original cross-section. */
interface IndexedSectionRegion {
  region: SectionRegion
  indices: number[]
}

/** Reflect an upper-only reference, and split signals into regions shielded by solid planes. */
export function sectionRegions(section: CrossSection): IndexedSectionRegion[] {
  const planes = [...section.planes].sort((a, b) => a.zMm - b.zMm)
  const groups = new Map<number, number[]>()
  for (const [i, conductor] of section.conductors.entries()) {
    const key = planes.filter((plane) => plane.zMm < conductor.zMm).length
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  return [...groups].map(([key, indices]) => {
    const below = planes[key - 1]
    const above = planes[key]
    const origin = below?.zMm ?? above.zMm
    const lower = below ?? above
    const conductors = indices.map((i) => {
      const c = section.conductors[i]
      if (below) return { ...c, zMm: c.zMm - origin }
      return { ...c, zMm: origin - c.zMm - c.thicknessMm }
    })
    let height = 0
    if (below && above) height = above.zMm - below.zMm
    const dielectrics = section.dielectrics
      .map((layer) => {
        let lo = Math.max(0, layer.zMm - origin)
        let hi = Math.min(
          height || Infinity,
          layer.zMm + layer.thicknessMm - origin,
        )
        if (!below) {
          lo = Math.max(0, origin - layer.zMm - layer.thicknessMm)
          hi = Math.min(height || Infinity, origin - layer.zMm)
        }
        return { ...layer, zMm: lo, thicknessMm: hi - lo }
      })
      .filter((layer) => layer.thicknessMm > SLAB_TOLERANCE_MM)
    return {
      indices,
      region: {
        conductors,
        dielectrics,
        height,
        lowerConductivity: lower.conductivitySm ?? copperConductivity,
        upperConductivity: above?.conductivitySm ?? copperConductivity,
      },
    }
  })
}

/** Segment geometry and material for a conductor or dielectric edge. */
interface SectionEdge {
  x1: number
  z1: number
  x2: number
  z2: number
  group: number
  er: number
  lossTangent: number
  contrast?: number
  derivative?: number
  reach?: number
}

/** Panels accumulated at the requested edge resolution. */
interface PanelMesh {
  count: number
  result: SectionPanel[]
}

/** Quartic grading resolves the integrable corner charge singularity. */
function panelFraction({ i, steps }: { i: number; steps: number }): number {
  const start = i ** PANEL_GRADING_POWER
  const end = (steps - i) ** PANEL_GRADING_POWER
  return start / (start + end)
}

/** Append panels along a straight segment, with its outward metal normal. */
function addSectionEdge({
  x1,
  z1,
  x2,
  z2,
  group,
  er,
  lossTangent,
  contrast = 0,
  derivative = 0,
  reach = Infinity,
  mesh,
}: SectionEdge & { mesh: PanelMesh }): void {
  const { count, result } = mesh
  const dx = x2 - x1
  const dz = z2 - z1
  const length = hypotenuse(dx, dz)
  let steps = Math.max(
    count,
    Math.ceil((count * length) / (FACE_LENGTH_IN_PLANE_DISTANCES * reach)),
  )
  if (dz)
    steps = Math.max(
      MIN_VERTICAL_PANELS,
      Math.ceil(count / VERTICAL_PANEL_DIVISOR),
    )
  for (let i = 0; i < steps; i++) {
    const lo = panelFraction({ i, steps })
    const hi = panelFraction({ i: i + 1, steps })
    result.push({
      x: x1 + (dx * (lo + hi)) / 2,
      z: z1 + (dz * (lo + hi)) / 2,
      tx: dx / length,
      tz: dz / length,
      length: length * (hi - lo),
      group,
      er,
      tangent: lossTangent,
      contrast,
      derivative,
    })
  }
}

/** Mesh one conductor's faces, splitting the sides wherever dielectric material changes. */
function appendConductorPanels({
  mesh,
  conductor,
  group,
  height,
  layers,
  probe,
  tolerance,
}: {
  mesh: PanelMesh
  conductor: SectionConductor
  group: number
  height: number
  layers: SectionDielectric[]
  probe: number
  tolerance: number
}): void {
  const bottom = conductor.zMm
  const top = bottom + conductor.thicknessMm
  const left = conductor.xMm - conductor.widthMm / 2
  const right = conductor.xMm + conductor.widthMm / 2
  const bottomMaterial = material({ layers, z: bottom - probe })
  const topMaterial = material({ layers, z: top + probe })
  let reach = bottom
  if (height) reach = Math.min(reach, height - top)
  addSectionEdge({
    x1: left,
    z1: bottom,
    x2: right,
    z2: bottom,
    group,
    ...bottomMaterial,
    reach,
    mesh,
  })
  addSectionEdge({
    x1: right,
    z1: top,
    x2: left,
    z2: top,
    group,
    ...topMaterial,
    reach,
    mesh,
  })
  const boundaries = layers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const interior = boundaries.filter(
    (z) => z > bottom + tolerance && z < top - tolerance,
  )
  const cuts = coordinates({ values: [bottom, top, ...interior], tolerance })
  for (let k = 1; k < cuts.length; k++) {
    const adjacent = material({ layers, z: (cuts[k - 1] + cuts[k]) / 2 })
    addSectionEdge({
      x1: right,
      z1: cuts[k - 1],
      x2: right,
      z2: cuts[k],
      group,
      ...adjacent,
      mesh,
    })
    addSectionEdge({
      x1: left,
      z1: cuts[k],
      x2: left,
      z2: cuts[k - 1],
      group,
      ...adjacent,
      mesh,
    })
  }
}

/** Quartically graded surface panels, split at all material and conductor projection boundaries.
 * Only dielectric interfaces are truncated horizontally; fields and solid planes remain infinite.
 * A conductor face longer than six plane distances gets proportionally more panels, so the middle panel
 * (about 4/count of the face) stays within about two plane distances of the charge it averages.
 */
export function sectionPanels({
  region,
  count,
  extent,
  vacuum,
}: SectionMeshInput): SectionPanel[] {
  const result: SectionPanel[] = []
  const conductorSpans = region.conductors.map((c) =>
    Math.max(c.widthMm, c.zMm + c.thicknessMm),
  )
  const slabTops = region.dielectrics.map(
    (layer) => layer.zMm + layer.thicknessMm,
  )
  const scale = Math.max(...conductorSpans, ...slabTops)
  const conductorSizes = region.conductors.flatMap((c) => [
    c.widthMm,
    c.thicknessMm,
  ])
  const slabThicknesses = region.dielectrics.map((layer) => layer.thicknessMm)
  const probe =
    Math.min(...conductorSizes, ...slabThicknesses) * MATERIAL_PROBE_FRACTION
  const tolerance = probe / COORDINATE_TOLERANCE_DIVISOR
  let layers = region.dielectrics
  if (vacuum) layers = []
  const mesh = { count, result }
  for (const [group, conductor] of region.conductors.entries()) {
    appendConductorPanels({
      mesh,
      conductor,
      group,
      height: region.height,
      layers,
      probe,
      tolerance,
    })
  }

  const projections = region.conductors.flatMap((c) => [
    c.xMm - c.widthMm / 2,
    c.xMm + c.widthMm / 2,
  ])
  const padding = extent * scale
  const first = Math.min(...projections) - padding
  const last = Math.max(...projections) + padding
  const xs = coordinates({ values: [first, ...projections, last], tolerance })
  const slabBoundaries = layers.flatMap((layer) => [
    layer.zMm,
    layer.zMm + layer.thicknessMm,
  ])
  const boundaries = coordinates({ values: slabBoundaries, tolerance }).filter(
    (z) => {
      return z > tolerance && (!region.height || z < region.height - tolerance)
    },
  )
  for (const z of boundaries) {
    const below = material({ layers, z: z - probe })
    const above = material({ layers, z: z + probe })
    if (below.er === above.er && below.lossTangent === above.lossTangent)
      continue
    const permittivitySum = below.er + above.er
    const contrast = (2 * (below.er - above.er)) / permittivitySum
    const derivative =
      (4 * below.er * above.er * (below.lossTangent - above.lossTangent)) /
      permittivitySum ** 2
    for (let k = 1; k < xs.length; k++) {
      const middle = (xs[k - 1] + xs[k]) / 2
      const covered = region.conductors.some((c) => {
        const withinWidth =
          middle > c.xMm - c.widthMm / 2 && middle < c.xMm + c.widthMm / 2
        return (
          withinWidth &&
          z >= c.zMm - probe &&
          z <= c.zMm + c.thicknessMm + probe
        )
      })
      if (covered) continue
      addSectionEdge({
        x1: xs[k - 1],
        z1: z,
        x2: xs[k],
        z2: z,
        group: DIELECTRIC_GROUP,
        er: 1,
        lossTangent: 0,
        contrast,
        derivative,
        mesh,
      })
    }
  }
  return result
}

/** Check conductor dimensions, clearance from planes and separation between rectangular signals. */
function validateConductors({ conductors, planes }: CrossSection): void {
  const ids = new Set(conductors.map((c) => c.id))
  if (ids.size !== conductors.length || [...ids].some((id) => !id)) {
    fail(
      "native_geometry",
      "Cross-section conductor IDs must be unique and nonempty",
    )
  }
  for (const c of conductors) {
    const conductivity = c.conductivitySm ?? copperConductivity
    const finite = [c.xMm, c.zMm, c.widthMm, c.thicknessMm, conductivity].every(
      Number.isFinite,
    )
    if (!finite || c.widthMm <= 0 || c.thicknessMm <= 0 || conductivity <= 0) {
      fail(
        "native_geometry",
        "Finite positive conductor dimensions and conductivity required",
      )
    }
    if (planes.some((p) => p.zMm >= c.zMm && p.zMm <= c.zMm + c.thicknessMm)) {
      fail("native_geometry", "A signal touches or crosses a reference plane")
    }
  }
  for (const [i, a] of conductors.entries()) {
    for (const b of conductors.slice(i + 1)) {
      const horizontalOverlap =
        Math.abs(a.xMm - b.xMm) <= (a.widthMm + b.widthMm) / 2
      const verticalOverlap =
        a.zMm <= b.zMm + b.thicknessMm && b.zMm <= a.zMm + a.thicknessMm
      if (horizontalOverlap && verticalOverlap)
        fail("native_geometry", "Signal rectangles overlap or touch")
    }
  }
}

/** Check that dielectric slabs have physical properties and occupy distinct height intervals. */
function validateDielectrics(dielectrics: SectionDielectric[]): void {
  for (const [i, a] of dielectrics.entries()) {
    const finite = [a.zMm, a.thicknessMm, a.er, a.lossTangent].every(
      Number.isFinite,
    )
    if (!finite || a.thicknessMm <= 0 || a.er < 1 || a.lossTangent < 0) {
      fail(
        "native_geometry",
        "Finite positive slabs, er >= 1 and nonnegative loss tangent required",
      )
    }
    const overlaps = dielectrics.slice(i + 1).some((b) => {
      return (
        a.zMm < b.zMm + b.thicknessMm - SLAB_TOLERANCE_MM &&
        b.zMm < a.zMm + a.thicknessMm - SLAB_TOLERANCE_MM
      )
    })
    if (overlaps) fail("native_geometry", "Dielectric slabs overlap")
  }
}

/** Reject unsupported/degenerate geometry rather than changing copper or material boundaries. */
export function validateSection(section: CrossSection): void {
  if (!section.conductors.length || !section.planes.length) {
    fail(
      "native_geometry",
      "A cross-section needs signals and at least one solid reference plane",
    )
  }
  validateConductors(section)
  for (const [i, plane] of section.planes.entries()) {
    const conductivity = plane.conductivitySm ?? copperConductivity
    const finite = [plane.zMm, conductivity].every(Number.isFinite)
    if (
      !finite ||
      conductivity <= 0 ||
      section.planes.slice(i + 1).some((p) => p.zMm === plane.zMm)
    ) {
      fail(
        "native_geometry",
        "Reference planes need unique finite heights and positive conductivity",
      )
    }
  }
  validateDielectrics(section.dielectrics)
}

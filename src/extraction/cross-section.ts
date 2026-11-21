import { hypotenuse } from "../kernel"
import { sectionField } from "./cross-section-field"
import { sectionInverse, sectionPassive } from "./cross-section-matrix"
import { sectionRegions, validateSection } from "./cross-section-mesh"
import {
  type CrossSection,
  type CrossSectionOptions,
  type CrossSectionResult,
  copperConductivity,
  type SectionMeshInput,
  type SectionRegion,
  sectionEpsilon0,
  sectionMu0,
} from "./cross-section-types"
import { fail } from "./diagnostics"
import { type Matrix, symmetrize } from "./linalg"

export type {
  CrossSection,
  CrossSectionOptions,
  CrossSectionResult,
  SectionConductor,
  SectionDielectric,
  SectionPlane,
} from "./cross-section-types"

/** Default and minimum counts of panels per conductor edge. */
const DEFAULT_PANELS_PER_EDGE = 12
/** Resolve conductor corners with a minimum of six panels per edge. */
const MIN_PANELS_PER_EDGE = 6

/** Default and minimum horizontal padding measured in cross-section spans. */
const DEFAULT_INTERFACE_EXTENT = 24
/** Keep dielectric interface truncation several spans from the conductors. */
const MIN_INTERFACE_EXTENT = 4

/** Recede conductor walls by a small fraction of their clearance for Wheeler loss. */
const DEFAULT_RECESSION_FRACTION = 0.01
/** Keep the recession step small relative to nearby features. */
const MAX_RECESSION_FRACTION = 0.1

/** Wall displacement is in millimeters and resistance is computed in SI units. */
const MILLIMETERS_PER_METER = 1000

/** Cross-sectional area is in square millimeters and DC resistance is computed in SI units. */
const SQUARE_MILLIMETERS_PER_SQUARE_METER = 1e6

/** Check panel resolution and interface padding shared by the capacitance and full field solvers. */
function validMesh({
  count,
  extent,
}: {
  count: number
  extent: number
}): boolean {
  return (
    Number.isInteger(count) &&
    count >= MIN_PANELS_PER_EDGE &&
    Number.isFinite(extent) &&
    extent >= MIN_INTERFACE_EXTENT
  )
}

/** Electrostatic-only extraction uses the identical dielectric solve without unused magnetic/loss solves. */
export function solveSectionCapacitance({
  section,
  options = {},
}: {
  section: CrossSection
  options?: Pick<CrossSectionOptions, "panelsPerEdge" | "interfaceExtent">
}): Matrix {
  validateSection(section)
  const count = options.panelsPerEdge ?? DEFAULT_PANELS_PER_EDGE
  const extent = options.interfaceExtent ?? DEFAULT_INTERFACE_EXTENT
  if (!validMesh({ count, extent }))
    fail("mesh_convergence", "Use >=6 panels per edge and interface extent >=4")
  const C = section.conductors.map(() => section.conductors.map(() => 0))
  for (const { region, indices } of sectionRegions(section)) {
    const field = sectionField({ region, count, extent })
    for (const [i, ii] of indices.entries()) {
      for (const [j, jj] of indices.entries()) C[ii][jj] = field.C[i][j]
    }
  }
  sectionPassive({ matrix: C, strict: true })
  return C
}

/** High-frequency external inductance from the vacuum Maxwell capacitance. */
function inductance(C0: Matrix): Matrix {
  return symmetrize(
    sectionInverse(C0).map((row) =>
      row.map((value) => sectionMu0 * sectionEpsilon0 * value),
    ),
  )
}

/** Recede every conducting wall (or only the signal conductors' walls) away from the field, weighted by its surface
 * resistivity. Vacuum is essential: moving a wall must not change the electrical dielectric geometry.
 */
function recede({
  region,
  distance,
  fixedPlanes = false,
}: {
  region: SectionRegion
  distance: number
  fixedPlanes?: boolean
}): SectionRegion {
  let lower = 0
  let upper = 0
  if (!fixedPlanes) {
    lower = distance * Math.sqrt(copperConductivity / region.lowerConductivity)
    upper = distance * Math.sqrt(copperConductivity / region.upperConductivity)
  }
  let height = 0
  if (region.height) height = region.height + lower + upper
  const conductors = region.conductors.map((c) => {
    const shift =
      distance *
      Math.sqrt(copperConductivity / (c.conductivitySm ?? copperConductivity))
    return {
      ...c,
      widthMm: c.widthMm - 2 * shift,
      thicknessMm: c.thicknessMm - 2 * shift,
      zMm: c.zMm + shift + lower,
    }
  })
  return {
    ...region,
    dielectrics: [],
    height,
    conductors,
  }
}

/** Zero matrix in input conductor order. */
function zeroMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => Array(size).fill(0))
}

/** Bound wall recession by trace dimensions, dielectric gaps and surface resistivity. */
function recessionStep({
  region,
  fraction,
}: {
  region: SectionRegion
  fraction: number
}): number {
  const gaps = region.conductors.flatMap((a, i) =>
    region.conductors.slice(i + 1).map((b) => {
      const horizontal = Math.max(
        0,
        Math.abs(a.xMm - b.xMm) - (a.widthMm + b.widthMm) / 2,
      )
      const vertical = Math.max(
        0,
        a.zMm - b.zMm - b.thicknessMm,
        b.zMm - a.zMm - a.thicknessMm,
      )
      return hypotenuse(horizontal, vertical)
    }),
  )
  const conductorSpans = region.conductors.flatMap((c) => {
    const spans = [c.widthMm, c.thicknessMm, c.zMm]
    if (region.height) spans.push(region.height - c.zMm - c.thicknessMm)
    return spans
  })
  const scale = Math.min(
    ...conductorSpans.map((span) => span / 2),
    ...gaps.map((gap) => gap / 4),
  )
  const lowerWeight = Math.sqrt(copperConductivity / region.lowerConductivity)
  const upperWeight = Math.sqrt(copperConductivity / region.upperConductivity)
  const conductorWeights = region.conductors.map((c) => {
    return Math.sqrt(
      copperConductivity / (c.conductivitySm ?? copperConductivity),
    )
  })
  const weight = Math.max(1, lowerWeight, upperWeight, ...conductorWeights)
  return (fraction * scale) / weight
}

/** Wheeler resistance per sqrt(Hz) from inductances with walls receded by +step and -step. */
function wheeler({
  plus,
  minus,
  step,
}: {
  plus: number
  minus: number
  step: number
}): number {
  const gradient = (plus - minus) / ((2 * step) / MILLIMETERS_PER_METER)
  return (
    (gradient * Math.sqrt((Math.PI * sectionMu0) / copperConductivity)) /
    sectionMu0
  )
}

/** Compute external inductance after displacing the requested conducting walls. */
function recededInductance({
  mesh,
  distance,
  fixedPlanes,
}: {
  mesh: SectionMeshInput
  distance: number
  fixedPlanes?: boolean
}): Matrix {
  const region = recede({ region: mesh.region, distance, fixedPlanes })
  return inductance(sectionField({ ...mesh, region, vacuum: true }).C)
}

/** Cheap quasi-TEM extraction with infinite solid references, layered dielectric/mask boundaries
 * and Wheeler incremental-inductance conductor loss. No native processes or pipeline integration.
 * Default work is fixed; convergence is measured by independently changing the two mesh options.
 */
export function solveCrossSection({
  section,
  options = {},
}: {
  section: CrossSection
  options?: CrossSectionOptions
}): CrossSectionResult {
  validateSection(section)
  const count = options.panelsPerEdge ?? DEFAULT_PANELS_PER_EDGE
  const extent = options.interfaceExtent ?? DEFAULT_INTERFACE_EXTENT
  const fraction = options.recessionFraction ?? DEFAULT_RECESSION_FRACTION
  const validRecession =
    Number.isFinite(fraction) &&
    fraction > 0 &&
    fraction <= MAX_RECESSION_FRACTION
  if (!validMesh({ count, extent }) || !validRecession) {
    fail(
      "mesh_convergence",
      "Use >=6 panels per edge, interface extent >=4 and recession fraction in (0, .1]",
    )
  }
  const size = section.conductors.length
  const C = zeroMatrix(size)
  const C0 = zeroMatrix(size)
  const L = zeroMatrix(size)
  const dielectricLoss = zeroMatrix(size)
  const skinResistance = zeroMatrix(size)
  const stripSkinResistance = zeroMatrix(size)
  const dcResistance = zeroMatrix(size)
  let panels = 0
  let residual = 0
  let recessionMm = Infinity
  for (const { region, indices } of sectionRegions(section)) {
    const mesh = { region, count, extent }
    const vacuum = sectionField({ ...mesh, vacuum: true })
    const field = sectionField(mesh)
    const external = inductance(vacuum.C)
    const step = recessionStep({ region, fraction })
    const plus = recededInductance({ mesh, distance: step })
    const minus = recededInductance({ mesh, distance: -step })
    const stripPlus = recededInductance({
      mesh,
      distance: step,
      fixedPlanes: true,
    })
    const stripMinus = recededInductance({
      mesh,
      distance: -step,
      fixedPlanes: true,
    })
    for (const [i, ii] of indices.entries()) {
      for (const [j, jj] of indices.entries()) {
        C[ii][jj] = field.C[i][j]
        C0[ii][jj] = vacuum.C[i][j]
        L[ii][jj] = external[i][j]
        dielectricLoss[ii][jj] = field.loss[i][j]
        skinResistance[ii][jj] = wheeler({
          plus: plus[i][j],
          minus: minus[i][j],
          step,
        })
        stripSkinResistance[ii][jj] = wheeler({
          plus: stripPlus[i][j],
          minus: stripMinus[i][j],
          step,
        })
      }
    }
    panels += field.panels
    residual = Math.max(residual, field.residual, vacuum.residual)
    recessionMm = Math.min(recessionMm, step)
  }
  for (const matrix of [C, C0, L]) sectionPassive({ matrix, strict: true })
  for (const matrix of [dielectricLoss, skinResistance, stripSkinResistance])
    sectionPassive({ matrix })
  for (const [i, c] of section.conductors.entries()) {
    const conductivity = c.conductivitySm ?? copperConductivity
    dcResistance[i][i] =
      SQUARE_MILLIMETERS_PER_SQUARE_METER /
      (conductivity * c.widthMm * c.thicknessMm)
  }
  return {
    conductorIds: section.conductors.map((c) => c.id),
    C,
    C0,
    L,
    dielectricLoss,
    dcResistance,
    skinResistance,
    stripSkinResistance,
    diagnostics: { panels, reciprocityResidual: residual, recessionMm },
  }
}

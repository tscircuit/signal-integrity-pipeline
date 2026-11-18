import { sectionField } from './cross-section-field'
import { sectionRegions, validateSection } from './cross-section-mesh'
import { sectionInverse, sectionPassive } from './cross-section-matrix'
import { copperConductivity, sectionEpsilon0, sectionMu0, type CrossSection, type CrossSectionOptions, type CrossSectionResult, type SectionRegion } from './cross-section-types'
import { fail } from './diagnostics'
import { symmetrize, type Matrix } from './linalg'

export type { CrossSection, CrossSectionOptions, CrossSectionResult, SectionConductor, SectionPlane, SectionDielectric } from './cross-section-types'

/** Electrostatic-only extraction uses the identical dielectric solve without unused magnetic/loss solves. */
export function solveSectionCapacitance(section: CrossSection, options: Pick<CrossSectionOptions, 'panelsPerEdge' | 'interfaceExtent'> = {}): Matrix {
  validateSection(section)
  const count = options.panelsPerEdge ?? 12
  const extent = options.interfaceExtent ?? 24
  if (!Number.isInteger(count) || count < 6 || !Number.isFinite(extent) || extent < 4) fail('mesh_convergence', 'Use >=6 panels per edge and interface extent >=4')
  const C = section.conductors.map(() => section.conductors.map(() => 0))
  for (const { region, indices } of sectionRegions(section)) {
    const field = sectionField({ region, count, extent })
    for (const [i, ii] of indices.entries()) for (const [j, jj] of indices.entries()) C[ii][jj] = field.C[i][j]
  }
  sectionPassive(C, true)
  return C
}

/** High-frequency external inductance from the vacuum Maxwell capacitance. */
function inductance(C0: Matrix): Matrix {
  return symmetrize(sectionInverse(C0).map(row => row.map(value => sectionMu0 * sectionEpsilon0 * value)))
}

/** Recede every conducting wall (or only the signal conductors' walls) away from the field, weighted by its surface
 * resistivity. Vacuum is essential: moving a wall must not change the electrical dielectric geometry.
 */
function recede({ region, distance, fixedPlanes = false }: { region: SectionRegion; distance: number; fixedPlanes?: boolean }): SectionRegion {
  let lower = 0
  let upper = 0
  if (!fixedPlanes) {
    lower = distance * Math.sqrt(copperConductivity / region.lowerConductivity)
    upper = distance * Math.sqrt(copperConductivity / region.upperConductivity)
  }
  let height = 0
  if (region.height) height = region.height + lower + upper
  return { ...region, dielectrics: [], height, conductors: region.conductors.map(c => {
    const shift = distance * Math.sqrt(copperConductivity / (c.conductivitySm ?? copperConductivity))
    return { ...c, widthMm: c.widthMm - 2 * shift, thicknessMm: c.thicknessMm - 2 * shift, zMm: c.zMm + shift + lower }
  }) }
}

/** Zero matrix in input conductor order. */
function zeroMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => Array(size).fill(0))
}

/** Bound wall recession by trace dimensions, dielectric gaps and surface resistivity. */
function recessionStep(region: SectionRegion, fraction: number): number {
  const gaps = region.conductors.flatMap((a, i) => region.conductors.slice(i + 1).map(b => Math.hypot(Math.max(0, Math.abs(a.xMm - b.xMm) - (a.widthMm + b.widthMm) / 2), Math.max(0, a.zMm - b.zMm - b.thicknessMm, b.zMm - a.zMm - a.thicknessMm))))
  const conductorSpans = region.conductors.flatMap(c => {
    const spans = [c.widthMm, c.thicknessMm, c.zMm]
    if (region.height) spans.push(region.height - c.zMm - c.thicknessMm)
    return spans
  })
  const scale = Math.min(...conductorSpans.map(span => span / 2), ...gaps.map(gap => gap / 4))
  const weight = Math.max(1, Math.sqrt(copperConductivity / region.lowerConductivity), Math.sqrt(copperConductivity / region.upperConductivity), ...region.conductors.map(c => Math.sqrt(copperConductivity / (c.conductivitySm ?? copperConductivity))))
  return fraction * scale / weight
}

/** Wheeler resistance per sqrt(Hz) from inductances with walls receded by +step and -step. */
function wheeler({ plus, minus, step }: { plus: number; minus: number; step: number }): number {
  return (plus - minus) / (2 * step / 1000) * Math.sqrt(Math.PI * sectionMu0 / copperConductivity) / sectionMu0
}

/** Cheap quasi-TEM extraction with infinite solid references, layered dielectric/mask boundaries
 * and Wheeler incremental-inductance conductor loss. No native processes or pipeline integration.
 * Default work is fixed; convergence is measured by independently changing the two mesh options.
 */
export function solveCrossSection(section: CrossSection, options: CrossSectionOptions = {}): CrossSectionResult {
  validateSection(section)
  const count = options.panelsPerEdge ?? 12
  const extent = options.interfaceExtent ?? 24
  const fraction = options.recessionFraction ?? .01
  if (!Number.isInteger(count) || count < 6 || !Number.isFinite(extent) || extent < 4 || !Number.isFinite(fraction) || fraction <= 0 || fraction > .1) fail('mesh_convergence', 'Use >=6 panels per edge, interface extent >=4 and recession fraction in (0, .1]')
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
    const step = recessionStep(region, fraction)
    const plus = inductance(sectionField({ region: recede({ region, distance: step }), count, extent, vacuum: true }).C)
    const minus = inductance(sectionField({ region: recede({ region, distance: -step }), count, extent, vacuum: true }).C)
    const stripPlus = inductance(sectionField({ region: recede({ region, distance: step, fixedPlanes: true }), count, extent, vacuum: true }).C)
    const stripMinus = inductance(sectionField({ region: recede({ region, distance: -step, fixedPlanes: true }), count, extent, vacuum: true }).C)
    for (const [i, ii] of indices.entries()) for (const [j, jj] of indices.entries()) {
      C[ii][jj] = field.C[i][j]
      C0[ii][jj] = vacuum.C[i][j]
      L[ii][jj] = external[i][j]
      dielectricLoss[ii][jj] = field.loss[i][j]
      skinResistance[ii][jj] = wheeler({ plus: plus[i][j], minus: minus[i][j], step })
      stripSkinResistance[ii][jj] = wheeler({ plus: stripPlus[i][j], minus: stripMinus[i][j], step })
    }
    panels += field.panels
    residual = Math.max(residual, field.residual, vacuum.residual)
    recessionMm = Math.min(recessionMm, step)
  }
  for (const matrix of [C, C0, L]) sectionPassive(matrix, true)
  for (const matrix of [dielectricLoss, skinResistance, stripSkinResistance]) sectionPassive(matrix)
  for (const [i, c] of section.conductors.entries()) dcResistance[i][i] = 1e6 / ((c.conductivitySm ?? copperConductivity) * c.widthMm * c.thicknessMm)
  return { conductorIds: section.conductors.map(c => c.id), C, C0, L, dielectricLoss, dcResistance, skinResistance, stripSkinResistance, diagnostics: { panels, reciprocityResidual: residual, recessionMm } }
}

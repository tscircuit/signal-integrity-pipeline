import type { Matrix } from "../../src/kernel"
import { type CrossSection, calculateCapacitanceMatrix } from "../../src/rlgc"
import { stripline } from "./cross-section-reference"

/** Relative permittivity of the vacuum-only fixture. */
export const VACUUM_RELATIVE_PERMITTIVITY = 1

/** The default Cohn comparison accepts 1% mesh error for C and Z0. */
export const COHN_DEFAULT_TOLERANCE = 0.01

/** The finer 24-panel mesh accepts 0.5% capacitance error. */
export const COHN_FINE_TOLERANCE = 0.005

/** The Cohn refinement comparison has a 0.02% thickness-bias floor. */
export const COHN_REFINEMENT_FLOOR = 2e-4

/** The 20:1 strip should lie within 3% of the parallel-plate limit. */
export const PARALLEL_PLATE_TOLERANCE = 0.03

/** Allow only roundoff in the exact homogeneous L C identity. */
export const HOMOGENEOUS_IDENTITY_TOLERANCE = 1e-9

/** Allow only floating-point error in the exact DC resistance check. */
export const DC_RESISTANCE_TOLERANCE = 1e-12

/** The independent Wheeler derivative should agree within 1%. */
export const WHEELER_TOLERANCE = 0.01

/** Allow 10% against Pozar's attenuation curve fit. */
export const POZAR_TOLERANCE = 0.1

/** Vacuum permittivity in farads per metre. */
export const epsilon0 = 8.8541878128e-12

/** Vacuum permeability in henries per metre. */
export const mu0 = 1.25663706212e-6

/** Copper conductivity in siemens per metre for the reference checks. */
export const copper = 5.8e7

/**
 * One strip of width w and thickness t centred between planes at z = 0 and b (mm), filled with one lossless
 * dielectric.
 */
export function centred({
  w,
  b,
  t,
  er = VACUUM_RELATIVE_PERMITTIVITY,
}: {
  w: number
  b: number
  t: number
  er?: number
}): CrossSection {
  const section: CrossSection = {
    conductors: [
      {
        conductorId: "s",
        xMm: 0,
        zMm: (b - t) / 2,
        widthMm: w,
        thicknessMm: t,
      },
    ],
    planes: [{ zMm: 0 }, { zMm: b }],
    dielectricLayers: [],
  }
  if (er > 1) {
    section.dielectricLayers = [
      {
        zMm: 0,
        thicknessMm: b,
        relativePermittivity: er,
        lossTangent: 0,
      },
    ]
  }
  return section
}

/** Small Gauss–Jordan inverse, independent of the solver's factorization. */
export function invert(matrix: Matrix): Matrix {
  const n = matrix.length
  const a = matrix.map((row, i) => [
    ...row,
    ...row.map((_, j) => Number(i === j)),
  ])
  for (let k = 0; k < n; k++) {
    const pivot = a.slice(k).reduce((best, row, i) => {
      if (Math.abs(row[k]) > Math.abs(a[best][k])) return k + i
      return best
    }, k)
    const swap = a[k]
    a[k] = a[pivot]
    a[pivot] = swap
    const scale = a[k][k]
    a[k] = a[k].map((value) => value / scale)
    for (let i = 0; i < n; i++) {
      if (i === k) continue
      const factor = a[i][k]
      a[i] = a[i].map((value, j) => value - factor * a[k][j])
    }
  }
  return a.map((row) => row.slice(n))
}

/** Surface resistance divided by sqrt(f): Rs = rho/delta = sqrt(pi f mu0 / sigma), delta = sqrt(rho/(pi f mu0)). */
export const surface = (conductivity: number): number =>
  Math.sqrt((Math.PI * mu0) / conductivity)

/** Solver C error against Cohn's exact zero-thickness stripline, per panels-per-edge count (t/b = 5e-4, er = 4). */
export function cohnErrors({
  ratio,
  panels,
}: {
  ratio: number
  panels: number[]
}): Map<number, number> {
  const exact = stripline({ w: ratio, b: 1, er: 4 })
  return new Map(
    panels.map((count) => {
      const achieved = calculateCapacitanceMatrix({
        crossSection: centred({ w: ratio, b: 1, t: 5e-4, er: 4 }),
        options: { panelsPerEdge: count },
      })
      return [count, Math.abs(achieved[0][0] / exact.capacitance - 1)]
    }),
  )
}

/** Solved and exact capacitance normalized by ideal parallel-plate capacitance. */
export interface ParallelPlateRatios {
  solved: number
  exact: number
}

/** Solver C / parallel-plate C and Cohn's exact ratio for a strip of width ratio*b (b = 1 mm, t = 5e-4 mm, er 4). */
export function parallelPlate(ratio: number): ParallelPlateRatios {
  const capacitance = calculateCapacitanceMatrix({
    crossSection: centred({ w: ratio, b: 1, t: 5e-4, er: 4 }),
  })[0][0]
  return {
    solved: capacitance / ((4 * epsilon0 * 4 * ratio) / (1 - 5e-4)),
    exact:
      stripline({ w: ratio, b: 1, er: 4 }).capacitance /
      (4 * epsilon0 * 4 * ratio),
  }
}

// High-frequency conductor loss. Wheeler, "Formulas for the skin effect", Proc. IRE 30 (1942) 412–424:
// R = (Rs/mu0) dL/dn with every wall receded by n, Rs = sqrt(pi f mu0/sigma) = rho/delta. Each check has its own
// a-priori tolerance, stated beside it.
/** Vacuum L = mu0 eps0 C0^-1 with every copper wall receded by n mm. */
export function recededInductance({
  section,
  offsetMm,
}: {
  section: CrossSection
  offsetMm: number
}): Matrix {
  return invert(
    calculateCapacitanceMatrix({
      crossSection: {
        dielectricLayers: [],
        planes: section.planes.map((p) => {
          if (p.zMm < section.conductors[0].zMm)
            return { zMm: p.zMm - offsetMm }
          return { zMm: p.zMm + offsetMm }
        }),
        conductors: section.conductors.map((c) => ({
          ...c,
          zMm: c.zMm + offsetMm,
          widthMm: c.widthMm - 2 * offsetMm,
          thicknessMm: c.thicknessMm - 2 * offsetMm,
        })),
      },
    }),
  ).map((row) => row.map((value) => mu0 * epsilon0 * value))
}

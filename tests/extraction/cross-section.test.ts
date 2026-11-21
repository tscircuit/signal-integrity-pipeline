import { setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import {
  type CrossSection,
  type CrossSectionResult,
  type Matrix,
  solveCrossSection,
  solveSectionCapacitance,
} from "../../src/extraction"
import { sectionFixture } from "../fixtures/cross-section"
import {
  coupledMicrostrip,
  coupledStripline,
  pozarStriplineAttenuation,
  singleMicrostrip,
  stripline,
} from "../fixtures/cross-section-reference"
import {
  energyFacts,
  hasNonnegativeLoss,
  isGroundedMaxwell,
  isPositiveDefinite,
  maxwellFacts,
} from "../support/golden-checks"

setDefaultTimeout(30_000)

/** Speed of light in vacuum in meters per second, exact in SI. */
const LIGHT_SPEED = 299792458

/** Independent Cholesky test of strict positive definiteness, scaled to matrix magnitude. */
function positive(matrix: Matrix): void {
  const a = matrix.map((row) => [...row])
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j <= i; j++) {
      let value = a[i][j]
      for (let k = 0; k < j; k++) value -= a[i][k] * a[j][k]
      if (i === j) {
        assert.ok(value > 0, `positive pivot ${i}: ${value}`)
        a[i][j] = Math.sqrt(value)
        continue
      }
      a[i][j] = value / a[j][j]
    }
  }
}

/** Impedances and effective permittivities for the even and odd modes of two identical lines. */
interface CoupledModes {
  ze: number
  zo: number
  ee: number
  eo: number
}

/** Both scalar modal impedances, for two identical lines in a symmetric cross-section. */
function modes(result: CrossSectionResult): CoupledModes {
  return {
    ze: Math.sqrt(
      (result.L[0][0] + result.L[0][1]) / (result.C[0][0] + result.C[0][1]),
    ),
    zo: Math.sqrt(
      (result.L[0][0] - result.L[0][1]) / (result.C[0][0] - result.C[0][1]),
    ),
    ee: (result.C[0][0] + result.C[0][1]) / (result.C0[0][0] + result.C0[0][1]),
    eo: (result.C[0][0] - result.C[0][1]) / (result.C0[0][0] - result.C0[0][1]),
  }
}

/** Relative coefficient error, including mutual coefficients rather than just a diagonal norm. */
function error({
  actual,
  expected,
}: {
  actual: number
  expected: number
}): number {
  return Math.abs(actual / expected - 1)
}

/** Compare material and vacuum capacitance, inductance and energy loss under mesh/domain changes. */
function change({
  a,
  b,
}: {
  a: CrossSectionResult
  b: CrossSectionResult
}): number {
  let largest = 0
  for (const key of ["C", "C0", "L", "dielectricLoss"] as const) {
    for (let i = 0; i < a.C.length; i++) {
      for (let j = 0; j < a.C.length; j++) {
        largest = Math.max(
          largest,
          error({ actual: a[key][i][j], expected: b[key][i][j] }),
        )
      }
    }
  }
  return largest
}

/** Isolated-line impedance and effective permittivity for each geometry. */
function singleLineReference(
  kind: "microstrip" | "stripline",
): ReturnType<typeof singleMicrostrip> {
  if (kind === "microstrip") return singleMicrostrip({ u: 1, er: 4 })
  const line = coupledStripline({
    width: 1,
    gap: 100,
    planeSpacing: 2.001,
    er: 4,
  })
  return { z: line.ze, ee: 4 }
}

/** Compare a single-line solve with the independent isolated-line formulas. */
function singleLineError({
  result,
  kind,
}: {
  result: CrossSectionResult
  kind: "microstrip" | "stripline"
}): number {
  const reference = singleLineReference(kind)
  const C = Math.sqrt(reference.ee) / (LIGHT_SPEED * reference.z)
  const L = (reference.z * Math.sqrt(reference.ee)) / LIGHT_SPEED
  const capacitance = result.C[0][0]
  const inductance = result.L[0][0]
  return Math.max(
    error({ actual: capacitance, expected: C }),
    error({ actual: inductance, expected: L }),
    error({
      actual: Math.sqrt(inductance / capacitance),
      expected: reference.z,
    }),
    error({
      actual: Math.sqrt(inductance * capacitance),
      expected: Math.sqrt(reference.ee) / LIGHT_SPEED,
    }),
  )
}

/** Coupled-line impedance and effective permittivity for each geometry. */
function coupledLineReference(
  kind: "microstrip" | "stripline",
): ReturnType<typeof coupledMicrostrip> {
  if (kind === "microstrip")
    return coupledMicrostrip({ width: 1, gap: 0.5, er: 4 })
  const line = coupledStripline({
    width: 1,
    gap: 0.5,
    planeSpacing: 2.001,
    er: 4,
  })
  return { ...line, ee: 4, eo: 4 }
}

/** Compare even, odd and mutual entries with the independent two-line formulas. */
function coupledLineError({
  result,
  kind,
}: {
  result: CrossSectionResult
  kind: "microstrip" | "stripline"
}): number {
  const expected = coupledLineReference(kind)
  const actual = modes(result)
  let maximum = Math.max(
    error({ actual: actual.ze, expected: expected.ze }),
    error({ actual: actual.zo, expected: expected.zo }),
    error({ actual: result.L[0][1], expected: expected.l12 }),
    error({ actual: result.C[0][1], expected: expected.c12 }),
  )
  for (const [sign, ee, z] of [
    [1, expected.ee, expected.ze],
    [-1, expected.eo, expected.zo],
  ]) {
    const cm = result.C[0][0] + sign * result.C[0][1]
    const lm = result.L[0][0] + sign * result.L[0][1]
    maximum = Math.max(
      maximum,
      error({ actual: cm, expected: Math.sqrt(ee) / (LIGHT_SPEED * z) }),
      error({ actual: lm, expected: (z * Math.sqrt(ee)) / LIGHT_SPEED }),
      error({
        actual: Math.sqrt(lm * cm),
        expected: Math.sqrt(ee) / LIGHT_SPEED,
      }),
    )
  }
  return maximum
}

test("line parameters match analytic references", () => {
  const rows: Record<string, string | number>[] = []
  for (const kind of ["microstrip", "stripline"] as const) {
    for (const count of [1, 2] as const) {
      const section = sectionFixture({ kind, count })
      const start = performance.now()
      const result = solveCrossSection({ section })
      const elapsed = performance.now() - start
      let maximum: number
      switch (count) {
        case 1:
          maximum = singleLineError({ result, kind })
          break
        case 2:
          maximum = coupledLineError({ result, kind })
          break
      }
      assert.ok(
        maximum < 0.02,
        `${kind} ${count}: worst C/L/Z/delay/mutual error ${maximum}`,
      )
      rows.push({
        fixture: `${kind} ${count}`,
        panels: result.diagnostics.panels,
        ms: +elapsed.toFixed(2),
        worstErrorPercent: +(100 * maximum).toFixed(3),
      })
      for (const matrix of [
        result.C,
        result.C0,
        result.L,
        result.dielectricLoss,
        result.skinResistance,
      ]) {
        positive(matrix)
        for (let i = 0; i < count; i++) {
          for (let j = 0; j < count; j++) {
            assert.ok(
              Math.abs(matrix[i][j] - matrix[j][i]) <
                1e-14 * Math.abs(matrix[i][i]),
            )
          }
        }
      }
      assert.ok(result.diagnostics.reciprocityResidual < 0.005)
    }
  }
  console.table(rows)
})

test("mesh and interface extent converge", () => {
  const rows: Record<string, string | number>[] = []
  const fixture = sectionFixture({ kind: "microstrip", count: 2 })
  const start = performance.now()
  const base = solveCrossSection({ section: fixture })
  const fine = solveCrossSection({
    section: fixture,
    options: { panelsPerEdge: 16 },
  })
  const wide = solveCrossSection({
    section: fixture,
    options: { interfaceExtent: 48 },
  })
  const mesh = change({ a: base, b: fine })
  const domain = change({ a: base, b: wide })
  assert.ok(mesh < 0.01, `mesh coefficient change ${mesh}`)
  assert.ok(domain < 0.01, `domain coefficient change ${domain}`)
  rows.push({
    fixture: "pair mesh 12→16 + domain 24→48 (all three)",
    ms: +(performance.now() - start).toFixed(2),
    meshPercent: +(100 * mesh).toFixed(3),
    domainPercent: +(100 * domain).toFixed(3),
  })
  console.table(rows)
})

test("twelve-line matrices preserve energy and signs", () => {
  const rows: Record<string, string | number>[] = []
  for (const kind of ["microstrip", "mask", "stripline"] as const) {
    const begin = performance.now()
    const result = solveCrossSection({
      section: sectionFixture({ kind, count: 12 }),
    })
    const elapsed = performance.now() - begin
    for (const matrix of [result.C, result.C0, result.L, result.skinResistance])
      positive(matrix)
    assert.ok(result.diagnostics.reciprocityResidual < 0.005)
    assert.ok(
      result.C.every((row, i) =>
        row.every((value, j) => {
          if (i === j) return value > 0
          return value <= 0
        }),
      ),
    )
    rows.push({
      fixture: `${kind} 12`,
      panels: result.diagnostics.panels,
      ms: +elapsed.toFixed(2),
      rawReciprocityPercent: +(
        result.diagnostics.reciprocityResidual * 100
      ).toFixed(3),
    })
  }
  console.table(rows)
})

test("electrostatic and full capacitance agree", () => {
  for (const kind of ["microstrip", "stripline"] as const) {
    const section = sectionFixture({ kind, count: 2 })
    assert.deepEqual(
      solveSectionCapacitance({ section }),
      solveCrossSection({ section }).C,
    )
  }
})

test("electrostatic extraction checks resolution", () => {
  const section = sectionFixture({ kind: "microstrip", count: 1 })
  assert.throws(
    () => solveSectionCapacitance({ section, options: { panelsPerEdge: 2 } }),
    /panels per edge/,
  )
})

// ---- Golden known-answer checks. Expected values and tolerances are fixed from the
// cited physics before the solver runs; a failing check is reported, never loosened.
// CODATA 2018 constants, defined independently of the solver.
/** Relative permittivity of the vacuum-only fixture. */
const VACUUM_RELATIVE_PERMITTIVITY = 1
/** The default Cohn comparison accepts 1% mesh error for C and Z0. */
const COHN_DEFAULT_TOLERANCE = 0.01
/** The finer 24-panel mesh accepts 0.5% capacitance error. */
const COHN_FINE_TOLERANCE = 0.005
/** The Cohn refinement comparison has a 0.02% thickness-bias floor. */
const COHN_REFINEMENT_FLOOR = 2e-4
/** The 20:1 strip should lie within 3% of the parallel-plate limit. */
const PARALLEL_PLATE_TOLERANCE = 0.03
/** Allow only roundoff in the exact homogeneous L C identity. */
const HOMOGENEOUS_IDENTITY_TOLERANCE = 1e-9
/** Allow only floating-point error in the exact DC resistance check. */
const DC_RESISTANCE_TOLERANCE = 1e-12
/** The independent Wheeler derivative should agree within 1%. */
const WHEELER_TOLERANCE = 0.01
/** The Richardson extrapolation should be within 2% of the wide-strip limit. */
const WIDE_STRIP_TOLERANCE = 0.02
/** Allow 10% against Pozar's attenuation curve fit. */
const POZAR_TOLERANCE = 0.1

/** Vacuum permittivity in farads per metre. */
const epsilon0 = 8.8541878128e-12
/** Vacuum permeability in henries per metre. */
const mu0 = 1.25663706212e-6
/** Copper conductivity in siemens per metre for the reference checks. */
const copper = 5.8e7

/**
 * One strip of width w and thickness t centred between planes at z = 0 and b (mm), filled with one lossless
 * dielectric.
 */
function centred({
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
        id: "s",
        xMm: 0,
        zMm: (b - t) / 2,
        widthMm: w,
        thicknessMm: t,
      },
    ],
    planes: [{ zMm: 0 }, { zMm: b }],
    dielectrics: [],
  }
  if (er > 1) {
    section.dielectrics = [
      {
        zMm: 0,
        thicknessMm: b,
        er,
        lossTangent: 0,
      },
    ]
  }
  return section
}

/** Small Gauss–Jordan inverse, independent of the solver's factorization. */
function invert(matrix: Matrix): Matrix {
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
const surface = (conductivity: number): number =>
  Math.sqrt((Math.PI * mu0) / conductivity)

/** Solver C error against Cohn's exact zero-thickness stripline, per panels-per-edge count (t/b = 5e-4, er = 4). */
function cohnErrors({
  ratio,
  panels,
}: {
  ratio: number
  panels: number[]
}): Map<number, number> {
  const exact = stripline({ w: ratio, b: 1, er: 4 })
  return new Map(
    panels.map((count) => {
      const achieved = solveSectionCapacitance({
        section: centred({ w: ratio, b: 1, t: 5e-4, er: 4 }),
        options: { panelsPerEdge: count },
      })
      return [count, Math.abs(achieved[0][0] / exact.capacitance - 1)]
    }),
  )
}

test("golden stage 3: Cohn exact stripline C and Z0 over w/b", () => {
  // Reference: Cohn (1954) exact conformal map, Z0 = eta0/(4 sqrt(er)) K(k)/K(k'), k = sech(pi w/2b)
  // (cross-section-reference.ts). The solver needs t > 0: t/b = 5e-4 raises C slightly (Cohn's thick-strip
  // fringing term). Tolerances: 1% at the default 12 panels/edge, the solver's own claimed mesh convergence
  // (12 -> 16 change < 1%, asserted above); 0.5% at 24 panels. The region is homogeneous: no interface truncation.
  const rows: Record<string, number>[] = []
  const failures: string[] = []
  for (const ratio of [0.25, 0.5, 1, 2, 4]) {
    const exact = stripline({ w: ratio, b: 1, er: 4 })
    const errors = cohnErrors({ ratio, panels: [6, 8, 12, 16, 24] })
    const line = solveCrossSection({
      section: centred({ w: ratio, b: 1, t: 5e-4, er: 4 }),
    })
    const zError = Math.abs(
      Math.sqrt(line.L[0][0] / line.C[0][0]) / exact.z - 1,
    )
    rows.push({
      wOverB: ratio,
      exactZ0: +exact.z.toFixed(3),
      z0ErrorPercent: +(100 * zError).toFixed(4),
      ...Object.fromEntries(
        [...errors].map(([panels, value]) => [
          `cErrorPercent@${panels}`,
          +(100 * value).toFixed(4),
        ]),
      ),
    })
    if (!(errors.get(12)! <= COHN_DEFAULT_TOLERANCE)) {
      failures.push(`w/b ${ratio}: C error ${errors.get(12)} at 12 panels > 1%`)
    }
    if (!(zError <= COHN_DEFAULT_TOLERANCE))
      failures.push(`w/b ${ratio}: Z0 error ${zError} > 1%`)
    if (!(errors.get(24)! <= COHN_FINE_TOLERANCE)) {
      failures.push(
        `w/b ${ratio}: C error ${errors.get(24)} at 24 panels > 0.5%`,
      )
    }
  }
  console.table(rows)
  assert.deepEqual(failures, [])
})

test("golden stage 3: Cohn stripline error shrinks from 6 to 24 panels per edge", () => {
  // Same reference as above, on a thinner strip. At t/b = 5e-4 the error plateaus near 0.26% (w/b 0.25): that is the
  // strip's thickness bias against Cohn's zero-thickness answer, larger than the 0.2% floor first declared. Declared
  // before this run: at t/b = 1e-5 the bias scales (t ln(1/t)) to ~0.007%, so the 24-panel error must not exceed
  // the 6-panel error unless both are under a 0.02% floor.
  const failures = [0.25, 0.5, 1, 2, 4].flatMap((ratio) => {
    const exact = stripline({ w: ratio, b: 1, er: 4 }).capacitance
    const [coarse, fine] = [6, 24].map((count) => {
      const section = centred({ w: ratio, b: 1, t: 1e-5, er: 4 })
      const capacitance = solveSectionCapacitance({
        section,
        options: { panelsPerEdge: count },
      })[0][0]
      return Math.abs(capacitance / exact - 1)
    })
    console.log(
      `w/b ${ratio}: |C/C_cohn - 1| = ${(100 * coarse).toFixed(4)}% (6) -> ${(100 * fine).toFixed(4)}% (24)`,
    )
    if (fine <= Math.max(coarse, COHN_REFINEMENT_FLOOR)) return []
    return [`w/b ${ratio}: ${coarse} (6) -> ${fine} (24)`]
  })
  assert.deepEqual(failures, [])
})

/** Solved and exact capacitance normalized by ideal parallel-plate capacitance. */
interface ParallelPlateRatios {
  solved: number
  exact: number
}

/** Solver C / parallel-plate C and Cohn's exact ratio for a strip of width ratio*b (b = 1 mm, t = 5e-4 mm, er 4). */
function parallelPlate(ratio: number): ParallelPlateRatios {
  const capacitance = solveSectionCapacitance({
    section: centred({ w: ratio, b: 1, t: 5e-4, er: 4 }),
  })[0][0]
  return {
    solved: capacitance / ((4 * epsilon0 * 4 * ratio) / (1 - 5e-4)),
    exact:
      stripline({ w: ratio, b: 1, er: 4 }).capacitance /
      (4 * epsilon0 * 4 * ratio),
  }
}

// A wide strip between planes is two parallel-plate capacitors, C_pp = eps w/d each with d = (b - t)/2.
// The exact excess (fringing) follows from Cohn's formula: C/C_pp -> 1 + (8 ln2/pi)/(4 w/b), i.e. 2.2% at w/b = 20.
// Declared checks: the solver ratio tracks Cohn's exact ratio within the same 1% mesh tolerance, decreases
// monotonically as w/b grows, and is within 3% of the parallel-plate value at w/b = 20.
test("golden stage 3: parallel-plate trend C/C_pp -> 1 for w/b = 2, 5, 10", () => {
  const rows = [2, 5, 10].map((ratio) => ({
    wOverB: ratio,
    ...parallelPlate(ratio),
  }))
  console.table(rows)
  assert.ok(
    rows.every(
      (row) => Math.abs(row.solved / row.exact - 1) <= COHN_DEFAULT_TOLERANCE,
    ),
    "tracks Cohn within 1%",
  )
  assert.ok(
    rows.every((row, i) => !i || row.solved < rows[i - 1].solved),
    "decreases monotonically",
  )
})

test("golden stage 3: parallel-plate limit at w/b = 20", () => {
  const wide = parallelPlate(20)
  const relativeError = Math.abs(wide.solved / wide.exact - 1)
  assert.ok(
    relativeError <= COHN_DEFAULT_TOLERANCE,
    `tracks Cohn within 1%: ${wide.solved} vs ${wide.exact}`,
  )
  assert.ok(
    wide.solved < parallelPlate(10).solved,
    "decreases monotonically from w/b = 10",
  )
  assert.ok(
    Math.abs(wide.solved - 1) <= PARALLEL_PLATE_TOLERANCE,
    `within 3% of C_pp: ${wide.solved}`,
  )
})

test("golden stage 3: homogeneous dielectric gives L C = mu0 eps0 er I for coupled lines (v = c/sqrt(er))", () => {
  // Quasi-TEM in one homogeneous medium: L C = mu eps I exactly, for any geometry (Paul, Analysis of Multiconductor
  // Transmission Lines, 2nd ed., section 3.2). Here L comes from the vacuum solve, so the identity also guards the
  // dielectric/vacuum plumbing; tolerance 1e-9 relative (floating point only).
  const cases: {
    label: string
    er: number
    section: CrossSection
  }[] = [
    {
      label: "stripline, 3 coupled lines, er 4",
      er: 4,
      section: {
        conductors: [-0.5, 0, 0.5].map((x, i) => ({
          id: `s${i}`,
          xMm: x,
          zMm: 0.4825,
          widthMm: 0.3,
          thicknessMm: 0.035,
        })),
        planes: [{ zMm: 0 }, { zMm: 1 }],
        dielectrics: [
          {
            zMm: 0,
            thicknessMm: 1,
            er: 4,
            lossTangent: 0,
          },
        ],
      },
    },
    {
      label: "air microstrip pair",
      er: 1,
      section: {
        conductors: [-0.75, 0.75].map((x, i) => ({
          id: `m${i}`,
          xMm: x,
          zMm: 1,
          widthMm: 1,
          thicknessMm: 0.035,
        })),
        planes: [{ zMm: 0 }],
        dielectrics: [],
      },
    },
  ]
  const failures: string[] = []
  for (const { label, er, section } of cases) {
    const line = solveCrossSection({ section })
    const target = mu0 * epsilon0 * er
    const product = line.L.map((row) =>
      line.C[0].map((_, j) =>
        row.reduce((sum, value, k) => sum + value * line.C[k][j], 0),
      ),
    )
    const relativeErrors = product.flatMap((row, i) =>
      row.map((value, j) => {
        if (i === j) return Math.abs(value - target) / target
        return Math.abs(value) / target
      }),
    )
    const worst = Math.max(...relativeErrors)
    const speedRatio = (
      1 /
      Math.sqrt(product[0][0]) /
      (1 / Math.sqrt(target))
    ).toFixed(12)
    const relativeError = worst.toExponential(3)
    const energy = `max |LC - mu eps er I| / (mu eps er) = ${relativeError}`
    console.log(
      `${label}: ${energy}; modal velocity / (c/sqrt(er)) = ${speedRatio}`,
    )
    if (!(worst <= HOMOGENEOUS_IDENTITY_TOLERANCE))
      failures.push(`${label}: ${worst}`)
  }
  assert.deepEqual(failures, [])
})

test("golden stage 3: DC resistance R = rho l / A", () => {
  // R per metre = 1/(sigma w t) exactly, 1e-12 relative; infinite planes carry no DC resistance in this model. The
  // deck's own DC path is check 25 (ngspice .op divider).
  const section: CrossSection = {
    conductors: [
      {
        id: "cu",
        xMm: -0.3,
        zMm: 0.4825,
        widthMm: 0.2,
        thicknessMm: 0.035,
      },
      {
        id: "alloy",
        xMm: 0.3,
        zMm: 0.491,
        widthMm: 0.15,
        thicknessMm: 0.018,
        conductivitySm: 3.5e7,
      },
    ],
    planes: [{ zMm: 0 }, { zMm: 1 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: 1,
        er: 4,
        lossTangent: 0.01,
      },
    ],
  }
  const line = solveCrossSection({ section })
  const expected = section.conductors.map((c) => {
    const conductivity = c.conductivitySm ?? copper
    return 1 / (conductivity * c.widthMm * 1e-3 * c.thicknessMm * 1e-3)
  })
  const failures: string[] = []
  for (const [i, value] of expected.entries()) {
    const resistance = line.dcResistance[i][i]
    if (!(Math.abs(resistance / value - 1) <= DC_RESISTANCE_TOLERANCE)) {
      failures.push(`R_dc ${i}: ${resistance} vs ${value}`)
    }
  }
  if (line.dcResistance[0][1] !== 0 || line.dcResistance[1][0] !== 0) {
    failures.push("ideal planes must not couple DC resistance")
  }
  assert.deepEqual(failures, [])
})

// High-frequency conductor loss. Wheeler, "Formulas for the skin effect", Proc. IRE 30 (1942) 412–424:
// R = (Rs/mu0) dL/dn with every wall receded by n, Rs = sqrt(pi f mu0/sigma) = rho/delta. Each check has its own
// a-priori tolerance, stated beside it.
/** Vacuum L = mu0 eps0 C0^-1 with every copper wall receded by n mm. */
function recededInductance({
  section,
  offsetMm,
}: {
  section: CrossSection
  offsetMm: number
}): Matrix {
  return invert(
    solveSectionCapacitance({
      section: {
        dielectrics: [],
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

test("golden stage 3: skin resistance equals Wheeler's rule recomputed independently", () => {
  // (b) Wheeler's rule recomputed here: own recession (planes move away, strips shrink), own step 5e-4 mm vs the
  // solver's ~1.75e-4 mm, from the solver's vacuum L = mu0 eps0 C0^-1. Within 1%: both are central differences of
  // the same smooth L(n), so a larger gap would be a units, constant or wall-direction error.
  const pair: CrossSection = {
    conductors: [-0.375, 0.375].map((x, i) => ({
      id: `m${i}`,
      xMm: x,
      zMm: 0.5,
      widthMm: 0.5,
      thicknessMm: 0.035,
    })),
    planes: [{ zMm: 0 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: 0.5,
        er: 4,
        lossTangent: 0,
      },
    ],
  }
  const failures: string[] = []
  const stripline = centred({ w: 1, b: 1, t: 0.035 })
  for (const [label, section] of [
    ["stripline w/b 1", stripline],
    ["microstrip pair", pair],
  ] as const) {
    const step = 5e-4
    const plus = recededInductance({ section, offsetMm: step })
    const minus = recededInductance({ section, offsetMm: -step })
    const solved = solveCrossSection({ section }).skinResistance
    const deviations = solved.flatMap((row, i) =>
      row.map((value, j) => {
        const derivative =
          ((surface(copper) / mu0) * (plus[i][j] - minus[i][j])) /
          (2 * step * 1e-3)
        return Math.abs(derivative / value - 1)
      }),
    )
    const worst = Math.max(...deviations)
    console.log(
      `${label}: worst |R_wheeler / R_solver - 1| = ${worst.toExponential(3)}`,
    )
    if (!(worst <= WHEELER_TOLERANCE)) failures.push(`${label}: ${worst}`)
  }
  assert.deepEqual(failures, [])
})

test("golden stage 3: wide stripline skin resistance approaches Rs/w", () => {
  // (c) Wide stripline limit R -> Rs/w (strip faces and both planes each carry half the current; Ramo, Whinnery &
  // Van Duzer, Fields and Waves, section 8.3). r = R w/Rs; Richardson 2 r(40) - r(20) within 2% of 1, r(20) >
  // r(40) > 1,
  // at the default and at 24 panels/edge.
  for (const panels of [12, 24]) {
    const [r20, r40] = [20, 40].map((w) => {
      const line = solveCrossSection({
        section: centred({ w, b: 1, t: 0.035 }),
        options: { panelsPerEdge: panels },
      })
      return (line.skinResistance[0][0] * w * 1e-3) / surface(copper)
    })
    const relativeError = Math.abs(2 * r40 - r20 - 1)
    assert.ok(
      relativeError <= WIDE_STRIP_TOLERANCE && r20 > r40 && r40 > 1,
      `${panels} panels: r20 ${r20}, r40 ${r40}`,
    )
  }
})

test("golden stage 3: stripline conductor attenuation agrees with Pozar's Wheeler-derived closed form", () => {
  // (d) Pozar's alpha_c (cross-section-reference.ts) at w/b = 0.5, 1, 2: within 10% (a curve fit). Pozar gives
  // attenuation, with his zero-thickness Z0 inside the formula, so the comparison is alpha_c = R / (2 Z0) with each
  // side's own Z0. Converting Pozar's alpha_c to R with his Z0 (65.4 ohm at w/b 1, against 61.3 ohm for this
  // t/b = 0.035 strip) biased R by (Z0 ratio)^2, about 12%.
  for (const ratio of [0.5, 1, 2]) {
    const line = solveCrossSection({
      section: centred({ w: ratio, b: 1, t: 0.035 }),
    })
    const solved =
      line.skinResistance[0][0] / (2 * Math.sqrt(line.L[0][0] / line.C[0][0]))
    const pozar = pozarStriplineAttenuation({
      w: ratio * 1e-3,
      b: 1e-3,
      t: 0.035e-3,
      er: 1,
      surfaceResistance: surface(copper),
    })
    console.log(`w/b ${ratio}: solver/Pozar alpha_c = ${solved / pozar}`)
    assert.ok(
      Math.abs(solved / pozar - 1) <= POZAR_TOLERANCE,
      `w/b ${ratio}: solver/Pozar ${solved / pozar}`,
    )
  }
})

test("golden invariants: extracted L, C0, C are SPD with |k| < 1, C is Maxwell, R(f) and G(f) are PSD", () => {
  // Passive reciprocal multiconductor lines (Paul, MTL 2nd ed., sections 3.2–3.4): L, C symmetric positive
  // definite, every pairwise |k| < 1; grounded Maxwell C has positive diagonal, negative off-diagonal entries and
  // non-negative row sums (capacitance to the references). Loss matrices R(f), G(f) are PSD. Tolerances are
  // floating point only: asymmetry 1e-12, row sums >= -1e-9 C_ii, PSD eigenvalues >= -1e-12 of the largest.
  const sections: {
    label: string
    section: CrossSection
  }[] = [
    ...(["microstrip", "stripline", "mask"] as const).flatMap((kind) =>
      [1, 2, 12].map((count) => ({
        label: `${kind} ${count}`,
        section: sectionFixture({ kind, count }),
      })),
    ),
    {
      label: "centred stripline w/b 1",
      section: centred({ w: 1, b: 1, t: 0.035, er: 4 }),
    },
  ]
  const rows: Record<string, number | string>[] = []
  const failures: string[] = []
  for (const { label, section } of sections) {
    const line = solveCrossSection({ section })
    let minimum = Infinity
    let coupling = 0
    for (const [name, matrix] of [
      ["L", line.L],
      ["C0", line.C0],
      ["C", line.C],
    ] as const) {
      const facts = energyFacts(matrix)
      minimum = Math.min(
        minimum,
        facts.minimumEigenvalue / facts.maximumEigenvalue,
      )
      coupling = Math.max(coupling, facts.coupling)
      if (!isPositiveDefinite(facts))
        failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    for (const name of ["C", "C0"] as const) {
      const facts = maxwellFacts(line[name])
      let offDiagonalLimit = 1
      if (section.conductors.length > 1) offDiagonalLimit = 0
      if (
        !isGroundedMaxwell({ facts, strictOffDiagonalLimit: offDiagonalLimit })
      ) {
        failures.push(`${label} ${name} Maxwell: ${JSON.stringify(facts)}`)
      }
    }
    // The ladder scales each loss matrix by a nonnegative network response (check 12), so PSD matrices give PSD
    // R(f), G(f).
    for (const name of [
      "dcResistance",
      "skinResistance",
      "stripSkinResistance",
      "dielectricLoss",
    ] as const) {
      const facts = energyFacts(line[name])
      if (hasNonnegativeLoss({ matrix: line[name], facts })) continue
      failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    rows.push({
      section: label,
      smallestEigenvalueRatio: +minimum.toExponential(3),
      largestCouplingK: +coupling.toFixed(4),
    })
  }
  console.table(rows)
  assert.deepEqual(failures, [])
})

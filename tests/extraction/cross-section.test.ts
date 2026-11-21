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
import { energyFacts, maxwellFacts } from "../support/golden-checks"

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

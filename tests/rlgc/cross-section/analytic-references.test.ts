import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc, type RlgcMatrices } from "../../../src/rlgc"
import {
  assertPositiveDefinite,
  crossSectionFixture,
} from "../../fixtures/cross-section"
import {
  coupledMicrostrip,
  coupledStripline,
  singleMicrostrip,
} from "../../fixtures/cross-section-reference"

/** Speed of light in vacuum in meters per second, exact in SI. */
const LIGHT_SPEED = 299792458

/** Impedances and effective permittivities for the even and odd modes of two identical lines. */
interface CoupledModes {
  ze: number
  zo: number
  ee: number
  eo: number
}

/** Both scalar modal impedances, for two identical lines in a symmetric cross-section. */
function modes(result: RlgcMatrices): CoupledModes {
  return {
    ze: Math.sqrt(
      (result.externalInductanceHenriesPerMeter[0][0] +
        result.externalInductanceHenriesPerMeter[0][1]) /
        (result.capacitanceFaradsPerMeter[0][0] +
          result.capacitanceFaradsPerMeter[0][1]),
    ),
    zo: Math.sqrt(
      (result.externalInductanceHenriesPerMeter[0][0] -
        result.externalInductanceHenriesPerMeter[0][1]) /
        (result.capacitanceFaradsPerMeter[0][0] -
          result.capacitanceFaradsPerMeter[0][1]),
    ),
    ee:
      (result.capacitanceFaradsPerMeter[0][0] +
        result.capacitanceFaradsPerMeter[0][1]) /
      (result.vacuumCapacitanceFaradsPerMeter[0][0] +
        result.vacuumCapacitanceFaradsPerMeter[0][1]),
    eo:
      (result.capacitanceFaradsPerMeter[0][0] -
        result.capacitanceFaradsPerMeter[0][1]) /
      (result.vacuumCapacitanceFaradsPerMeter[0][0] -
        result.vacuumCapacitanceFaradsPerMeter[0][1]),
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
  result: RlgcMatrices
  kind: "microstrip" | "stripline"
}): number {
  const reference = singleLineReference(kind)
  const C = Math.sqrt(reference.ee) / (LIGHT_SPEED * reference.z)
  const L = (reference.z * Math.sqrt(reference.ee)) / LIGHT_SPEED
  const capacitance = result.capacitanceFaradsPerMeter[0][0]
  const inductance = result.externalInductanceHenriesPerMeter[0][0]
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
  result: RlgcMatrices
  kind: "microstrip" | "stripline"
}): number {
  const expected = coupledLineReference(kind)
  const actual = modes(result)
  let maximum = Math.max(
    error({ actual: actual.ze, expected: expected.ze }),
    error({ actual: actual.zo, expected: expected.zo }),
    error({
      actual: result.externalInductanceHenriesPerMeter[0][1],
      expected: expected.l12,
    }),
    error({
      actual: result.capacitanceFaradsPerMeter[0][1],
      expected: expected.c12,
    }),
  )
  for (const [sign, ee, z] of [
    [1, expected.ee, expected.ze],
    [-1, expected.eo, expected.zo],
  ]) {
    const cm =
      result.capacitanceFaradsPerMeter[0][0] +
      sign * result.capacitanceFaradsPerMeter[0][1]
    const lm =
      result.externalInductanceHenriesPerMeter[0][0] +
      sign * result.externalInductanceHenriesPerMeter[0][1]
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
  for (const kind of ["microstrip", "stripline"] as const) {
    for (const count of [1, 2] as const) {
      const crossSection = crossSectionFixture({ kind, count })
      const result = calculateRlgc({ crossSection })
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
      for (const matrix of [
        result.capacitanceFaradsPerMeter,
        result.vacuumCapacitanceFaradsPerMeter,
        result.externalInductanceHenriesPerMeter,
        result.dielectricLossFaradsPerMeter,
        result.totalSkinResistanceOhmsPerMeterPerSqrtHz,
        result.conductorSkinResistanceOhmsPerMeterPerSqrtHz,
      ]) {
        assertPositiveDefinite(matrix)
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
}, 30_000)

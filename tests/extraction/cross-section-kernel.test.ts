import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, solveCrossSection } from "../../src/extraction"
import {
  coupledMicrostrip,
  imageMicrostrip,
  singleMicrostrip,
  thickMicrostrip,
} from "../fixtures/cross-section-reference"

/** Speed of light in vacuum in meters per second, exact in SI. */
const LIGHT_SPEED = 299792458

/** Normalized microstrip family; includes very thin, nearly coincident top/bottom panels. */
function fixture({
  width,
  gap,
  er,
  count,
  thickness,
}: {
  width: number
  gap: number
  er: number
  count: number
  thickness: number
}): CrossSection {
  return {
    conductors: Array.from({ length: count }, (_, i) => ({
      id: String(i),
      xMm: (i - (count - 1) / 2) * (width + gap),
      zMm: 1,
      widthMm: width,
      thicknessMm: thickness,
    })),
    planes: [{ zMm: 0 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: 1,
        er,
        lossTangent: 0,
      },
    ],
  }
}

test("thin microstrip matches H–J", () => {
  let maximum = 0
  for (const width of [0.25, 1, 3]) {
    for (const er of [2.2, 4, 10]) {
      const expected = singleMicrostrip({ u: width, er })
      const result = solveCrossSection({
        section: fixture({
          width,
          gap: 0,
          er,
          count: 1,
          thickness: 0.0001,
        }),
      })
      const C = Math.sqrt(expected.ee) / (LIGHT_SPEED * expected.z)
      const L = (expected.z * Math.sqrt(expected.ee)) / LIGHT_SPEED
      maximum = Math.max(
        maximum,
        Math.abs(result.C[0][0] / C - 1),
        Math.abs(result.L[0][0] / L - 1),
      )
    }
  }
  assert.ok(maximum < 0.02, `single C/L sweep: ${maximum}`)
  console.log({ singleSweepPercent: 100 * maximum })
})

test("thick microstrip matches H–J", () => {
  // Normalize the 100 um width and 35 um thickness to the 99.4 um reference height.
  const width = 0.1 / 0.0994
  const thickness = 0.035 / 0.0994
  const thick = solveCrossSection({
    section: fixture({
      width,
      gap: 0,
      er: 4.1,
      count: 1,
      thickness,
    }),
  })
  const referenceThick = thickMicrostrip({ width, er: 4.1, thickness })
  const thickC = Math.sqrt(referenceThick.ee) / (LIGHT_SPEED * referenceThick.z)
  const thickL = (referenceThick.z * Math.sqrt(referenceThick.ee)) / LIGHT_SPEED
  const thickZ = Math.sqrt(thick.L[0][0] / thick.C[0][0])
  const thickError = Math.max(
    Math.abs(thickZ / referenceThick.z - 1),
    Math.abs(thick.C[0][0] / thickC - 1),
    Math.abs(thick.L[0][0] / thickL - 1),
  )
  assert.ok(thickError < 0.02, `finite thickness H–J C/L/Z: ${thickError}`)

  console.log({ thickMicrostripPercent: 100 * thickError })
})

test("coupled modes match H–J", () => {
  let modal = 0
  for (const width of [0.5, 1, 2]) {
    for (const gap of [0.2, 0.5, 2]) {
      const expected = coupledMicrostrip({ width, gap, er: 4 })
      const result = solveCrossSection({
        section: fixture({
          width,
          gap,
          er: 4,
          count: 2,
          thickness: 0.001,
        }),
      })
      for (const [sign, ee, z] of [
        [1, expected.ee, expected.ze],
        [-1, expected.eo, expected.zo],
      ]) {
        const C = result.C[0][0] + sign * result.C[0][1]
        const L = result.L[0][0] + sign * result.L[0][1]
        modal = Math.max(
          modal,
          Math.abs(C / (Math.sqrt(ee) / (LIGHT_SPEED * z)) - 1),
          Math.abs(L / ((z * Math.sqrt(ee)) / LIGHT_SPEED) - 1),
          Math.abs(Math.sqrt(L / C) / z - 1),
          Math.abs((Math.sqrt(L * C) * LIGHT_SPEED) / Math.sqrt(ee) - 1),
        )
      }
    }
  }
  assert.ok(modal < 0.02, `coupled C/L/Z/delay sweep: ${modal}`)
  console.log({ coupledModalSweepPercent: 100 * modal })
})

test("weak coupling matches dielectric images", () => {
  // Small mutual C is a subtraction of empirical H–J modal coefficients; validate it against
  // a separate exact layered Green representation rather than infer a tight bound from that fit.
  let mutual = 0
  for (const [width, gap] of [
    [0.5, 2],
    [2, 2],
  ]) {
    const reference = imageMicrostrip({ width, gap, er: 4 })
    const refined = imageMicrostrip({ width, gap, er: 4, count: 48 })
    assert.ok(Math.abs(reference[0][1] / refined[0][1] - 1) < 0.001)
    const result = solveCrossSection({
      section: fixture({
        width,
        gap,
        er: 4,
        count: 2,
        thickness: 0.0001,
      }),
    })
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        mutual = Math.max(mutual, Math.abs(result.C[i][j] / refined[i][j] - 1))
      }
    }
  }
  assert.ok(mutual < 0.01, `independent image C entries: ${mutual}`)
  console.log({ imageReferenceEntriesPercent: 100 * mutual })
})

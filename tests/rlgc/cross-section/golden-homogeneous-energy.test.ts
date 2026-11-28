import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, calculateRlgc } from "../../../src/rlgc"
import {
  epsilon0,
  HOMOGENEOUS_IDENTITY_TOLERANCE,
  mu0,
} from "../../fixtures/rlgc-golden"

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
          conductorId: `s${i}`,
          xMm: x,
          zMm: 0.4825,
          widthMm: 0.3,
          thicknessMm: 0.035,
        })),
        planes: [{ zMm: 0 }, { zMm: 1 }],
        dielectricLayers: [
          {
            zMm: 0,
            thicknessMm: 1,
            relativePermittivity: 4,
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
          conductorId: `m${i}`,
          xMm: x,
          zMm: 1,
          widthMm: 1,
          thicknessMm: 0.035,
        })),
        planes: [{ zMm: 0 }],
        dielectricLayers: [],
      },
    },
  ]
  const failures: string[] = []
  for (const { label, er, section } of cases) {
    const line = calculateRlgc({ crossSection: section })
    const target = mu0 * epsilon0 * er
    const product = line.externalInductanceHenriesPerMeter.map((row) =>
      line.capacitanceFaradsPerMeter[0].map((_, j) =>
        row.reduce(
          (sum, value, k) => sum + value * line.capacitanceFaradsPerMeter[k][j],
          0,
        ),
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
}, 30_000)

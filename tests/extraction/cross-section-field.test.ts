import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, solveCrossSection } from "../../src/extraction"

// The parallel-plate limit independently tests material energy weighting and both reference/signal loss.
test("layered/mask energy sensitivity and Wheeler loss approach the analytic parallel-plate limits", () => {
  const section: CrossSection = {
    conductors: [
      {
        id: "s",
        xMm: 0,
        zMm: 0.2,
        widthMm: 100,
        thicknessMm: 0.035,
      },
    ],
    planes: [{ zMm: 0 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: 0.18,
        er: 4.1,
        lossTangent: 0.02,
      },
      {
        zMm: 0.18,
        thicknessMm: 0.02,
        er: 3.3,
        lossTangent: 0.025,
      },
    ],
  }
  const result = solveCrossSection({ section })
  const electrical = 0.18 / 4.1 + 0.02 / 3.3
  const expectedC = (8.8541878128e-12 * 100) / electrical
  const expectedLoss =
    (expectedC * ((0.18 / 4.1) * 0.02 + (0.02 / 3.3) * 0.025)) / electrical
  const rs = Math.sqrt((Math.PI * 1.25663706212e-6) / 5.8e7)
  const expectedSkin = rs * (2 / 0.1 + (2 * 0.0002) / 0.1 ** 2)
  assert.ok(Math.abs(result.C[0][0] / expectedC - 1) < 0.01)
  assert.ok(Math.abs(result.dielectricLoss[0][0] / expectedLoss - 1) < 0.01)
  assert.ok(Math.abs(result.skinResistance[0][0] / expectedSkin - 1) < 0.02)
  assert.ok(
    Math.abs(result.dcResistance[0][0] * (5.8e7 * 0.1 * 0.000035) - 1) < 1e-14,
  )
  // Finite difference is an independent oracle for the analytic directional sensitivity.
  const step = 0.001
  const plus = solveCrossSection({
    section: {
      ...section,
      dielectrics: section.dielectrics.map((d) => ({
        ...d,
        er: d.er * (1 + step * d.lossTangent),
      })),
    },
  })
  const minus = solveCrossSection({
    section: {
      ...section,
      dielectrics: section.dielectrics.map((d) => ({
        ...d,
        er: d.er * (1 - step * d.lossTangent),
      })),
    },
  })
  assert.ok(
    Math.abs(
      (plus.C[0][0] - minus.C[0][0]) /
        (2 * step) /
        result.dielectricLoss[0][0] -
        1,
    ) < 1e-6,
  )
  // Quartering conductivity doubles skin resistance and quadruples DC resistance.
  const conductivitySm = 5.8e7 / 4
  const lowerConductivity = solveCrossSection({
    section: {
      ...section,
      conductors: section.conductors.map((c) => ({ ...c, conductivitySm })),
      planes: section.planes.map((p) => ({ ...p, conductivitySm })),
    },
  })
  assert.ok(
    Math.abs(
      lowerConductivity.skinResistance[0][0] / result.skinResistance[0][0] - 2,
    ) < 1e-8,
  )
  assert.ok(
    Math.abs(
      lowerConductivity.dcResistance[0][0] / result.dcResistance[0][0] - 4,
    ) < 1e-12,
  )
  const half = solveCrossSection({
    section,
    options: { recessionFraction: 0.005 },
  })
  assert.ok(
    Math.abs(half.skinResistance[0][0] / result.skinResistance[0][0] - 1) <
      0.001,
  )
  // Equal er but different tangents must retain a loss-only dielectric interface.
  const dielectrics = section.dielectrics.map((d) => ({ ...d, er: 4 }))
  const equal = solveCrossSection({ section: { ...section, dielectrics } })
  const expectedEqual = (equal.C[0][0] * (0.18 * 0.02 + 0.02 * 0.025)) / 0.2
  assert.ok(Math.abs(equal.dielectricLoss[0][0] / expectedEqual - 1) < 0.005)
}, 300_000)

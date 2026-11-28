import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  type CrossSection,
  calculateCapacitanceMatrix,
  calculateRlgc,
} from "../../../src/rlgc"

test("layered/mask energy sensitivity and Wheeler loss approach the analytic parallel-plate limits", () => {
  const crossSection: CrossSection = {
    conductors: [
      {
        conductorId: "s",
        xMm: 0,
        zMm: 0.2,
        widthMm: 100,
        thicknessMm: 0.035,
      },
    ],
    planes: [{ zMm: 0 }],
    dielectricLayers: [
      {
        zMm: 0,
        thicknessMm: 0.18,
        relativePermittivity: 4.1,
        lossTangent: 0.02,
      },
      {
        zMm: 0.18,
        thicknessMm: 0.02,
        relativePermittivity: 3.3,
        lossTangent: 0.025,
      },
    ],
  }
  const options = { panelsPerEdge: 6 }
  const result = calculateRlgc({ crossSection, options })
  const electrical = 0.18 / 4.1 + 0.02 / 3.3
  const expectedC = (8.8541878128e-12 * 100) / electrical
  const expectedLoss =
    (expectedC * ((0.18 / 4.1) * 0.02 + (0.02 / 3.3) * 0.025)) / electrical
  const rs = Math.sqrt((Math.PI * 1.25663706212e-6) / 5.8e7)
  const expectedSkin = rs * (2 / 0.1 + (2 * 0.0002) / 0.1 ** 2)
  const expectedConductorSkin = rs * (1 / 0.1 + (2 * 0.0002) / 0.1 ** 2)
  assert.ok(
    Math.abs(
      result.conductorSkinResistanceOhmsPerMeterPerSqrtHz[0][0] /
        expectedConductorSkin -
        1,
    ) < 0.02,
  )
  assert.ok(
    result.conductorSkinResistanceOhmsPerMeterPerSqrtHz[0][0] <
      result.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0],
  )
  assert.ok(
    Math.abs(result.capacitanceFaradsPerMeter[0][0] / expectedC - 1) < 0.01,
  )
  assert.ok(
    Math.abs(result.dielectricLossFaradsPerMeter[0][0] / expectedLoss - 1) <
      0.01,
  )
  assert.ok(
    Math.abs(
      result.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] / expectedSkin - 1,
    ) < 0.02,
  )
  assert.ok(
    Math.abs(
      result.dcResistanceOhmsPerMeter[0][0] * (5.8e7 * 0.1 * 0.000035) - 1,
    ) < 1e-14,
  )
  // Finite difference is an independent oracle for the analytic directional sensitivity.
  const step = 0.001
  const plus = calculateCapacitanceMatrix({
    options,
    crossSection: {
      ...crossSection,
      dielectricLayers: crossSection.dielectricLayers.map((d) => ({
        ...d,
        relativePermittivity:
          d.relativePermittivity * (1 + step * d.lossTangent),
      })),
    },
  })
  const minus = calculateCapacitanceMatrix({
    options,
    crossSection: {
      ...crossSection,
      dielectricLayers: crossSection.dielectricLayers.map((d) => ({
        ...d,
        relativePermittivity:
          d.relativePermittivity * (1 - step * d.lossTangent),
      })),
    },
  })
  assert.ok(
    Math.abs(
      (plus[0][0] - minus[0][0]) /
        (2 * step) /
        result.dielectricLossFaradsPerMeter[0][0] -
        1,
    ) < 1e-6,
  )
  // Quartering conductivity doubles skin resistance and quadruples DC resistance.
  const conductivitySm = 5.8e7 / 4
  const lowerConductivity = calculateRlgc({
    options,
    crossSection: {
      ...crossSection,
      conductors: crossSection.conductors.map((c) => ({
        ...c,
        conductivitySm,
      })),
      planes: crossSection.planes.map((p) => ({ ...p, conductivitySm })),
    },
  })
  assert.ok(
    Math.abs(
      lowerConductivity.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] /
        result.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] -
        2,
    ) < 1e-8,
  )
  assert.ok(
    Math.abs(
      lowerConductivity.dcResistanceOhmsPerMeter[0][0] /
        result.dcResistanceOhmsPerMeter[0][0] -
        4,
    ) < 1e-12,
  )
  const half = calculateRlgc({
    crossSection,
    options: { ...options, recessionFraction: 0.005 },
  })
  assert.ok(
    Math.abs(
      half.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] /
        result.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] -
        1,
    ) < 0.001,
  )
  // Equal er but different tangents must retain a loss-only dielectric interface.
  const dielectricLayers = crossSection.dielectricLayers.map((d) => ({
    ...d,
    relativePermittivity: 4,
  }))
  const equal = calculateRlgc({
    crossSection: { ...crossSection, dielectricLayers },
    options,
  })
  const expectedEqual =
    (equal.capacitanceFaradsPerMeter[0][0] * (0.18 * 0.02 + 0.02 * 0.025)) / 0.2
  assert.ok(
    Math.abs(equal.dielectricLossFaradsPerMeter[0][0] / expectedEqual - 1) <
      0.005,
  )
}, 60_000)

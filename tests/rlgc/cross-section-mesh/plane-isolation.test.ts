import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("isolates fields across a plane", () => {
  const crossSection = crossSectionFixture({ kind: "mask", count: 2 })
  const shielded = calculateRlgc({
    crossSection: {
      ...crossSection,
      conductors: [
        crossSection.conductors[0],
        { ...crossSection.conductors[1], zMm: -1.035 },
      ],
      dielectricLayers: [],
    },
  })
  for (const matrix of [
    shielded.capacitanceFaradsPerMeter,
    shielded.vacuumCapacitanceFaradsPerMeter,
    shielded.externalInductanceHenriesPerMeter,
    shielded.totalSkinResistanceOhmsPerMeterPerSqrtHz,
    shielded.conductorSkinResistanceOhmsPerMeterPerSqrtHz,
    shielded.dielectricLossFaradsPerMeter,
  ]) {
    assert.equal(matrix[0][1], 0)
  }
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import type { RlgcMatrices } from "../../../src/rlgc"
import { screenWirePair } from "../../../src/rlgc/wire-coupling"

test("accepts either normalized mutual at exactly the coupling threshold", () => {
  const diagonal = [
    [1, 0],
    [0, 1],
  ]
  const uncoupled: RlgcMatrices = {
    conductorIds: ["0", "1"],
    capacitanceFaradsPerMeter: diagonal,
    vacuumCapacitanceFaradsPerMeter: diagonal,
    externalInductanceHenriesPerMeter: diagonal,
    dielectricLossFaradsPerMeter: diagonal,
    dcResistanceOhmsPerMeter: diagonal,
    totalSkinResistanceOhmsPerMeterPerSqrtHz: diagonal,
    conductorSkinResistanceOhmsPerMeterPerSqrtHz: diagonal,
    diagnostics: {
      panelCount: 0,
      reciprocityResidual: 0,
      recessionMm: 0,
    },
  }
  for (const { mutual, isCoupled } of [
    { mutual: 0.0049, isCoupled: false },
    { mutual: 0.005, isCoupled: true },
  ]) {
    const electric = screenWirePair({
      wireSectionIndex: 0,
      wireIndices: [0, 1],
      rlgcMatrices: {
        ...uncoupled,
        capacitanceFaradsPerMeter: [
          [1, -mutual],
          [-mutual, 1],
        ],
      },
    })
    const magnetic = screenWirePair({
      wireSectionIndex: 0,
      wireIndices: [0, 1],
      rlgcMatrices: {
        ...uncoupled,
        externalInductanceHenriesPerMeter: [
          [1, mutual],
          [mutual, 1],
        ],
      },
    })
    assert.equal(electric.normalizedMutualCapacitance, mutual)
    assert.equal(magnetic.normalizedMutualInductance, mutual)
    assert.equal(electric.isCoupled, isCoupled)
    assert.equal(magnetic.isCoupled, isCoupled)
  }
})

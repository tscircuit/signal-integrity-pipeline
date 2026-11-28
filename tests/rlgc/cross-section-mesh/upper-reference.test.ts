import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("reflects an upper reference plane", () => {
  const crossSection = crossSectionFixture({ kind: "mask", count: 2 })
  const original = calculateRlgc({ crossSection })
  const reflected = calculateRlgc({
    crossSection: {
      conductors: crossSection.conductors.map((c) => ({
        ...c,
        zMm: -c.zMm - c.thicknessMm,
      })),
      planes: crossSection.planes,
      dielectricLayers: crossSection.dielectricLayers.map((d) => ({
        ...d,
        zMm: -d.zMm - d.thicknessMm,
      })),
    },
  })
  for (const key of [
    "capacitanceFaradsPerMeter",
    "externalInductanceHenriesPerMeter",
  ] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(original[key][i][j] / reflected[key][i][j] - 1) < 1e-8,
        )
      }
    }
  }
})

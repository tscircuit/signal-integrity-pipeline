import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import {
  assertPositiveDefinite,
  crossSectionFixture,
} from "../../fixtures/cross-section"

test("twelve-line matrices preserve energy and signs", () => {
  for (const kind of ["microstrip", "mask", "stripline"] as const) {
    const result = calculateRlgc({
      crossSection: crossSectionFixture({ kind, count: 12 }),
    })
    for (const matrix of [
      result.capacitanceFaradsPerMeter,
      result.vacuumCapacitanceFaradsPerMeter,
      result.externalInductanceHenriesPerMeter,
      result.totalSkinResistanceOhmsPerMeterPerSqrtHz,
      result.conductorSkinResistanceOhmsPerMeterPerSqrtHz,
    ])
      assertPositiveDefinite(matrix)
    assert.ok(result.diagnostics.reciprocityResidual < 0.005)
    assert.ok(
      result.capacitanceFaradsPerMeter.every((row, i) =>
        row.every((coefficient, j) => {
          if (i === j) return coefficient > 0
          return coefficient <= 0
        }),
      ),
    )
  }
}, 30_000)

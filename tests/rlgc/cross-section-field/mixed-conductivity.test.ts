import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("lower plane conductivity scales only the plane contribution", () => {
  const crossSection = crossSectionFixture({ kind: "microstrip" })
  const base = calculateRlgc({ crossSection })
  const mixed = calculateRlgc({
    crossSection: {
      ...crossSection,
      planes: [{ zMm: 0, conductivitySm: 5.8e7 / 4 }],
    },
  })
  const own = base.conductorSkinResistanceOhmsPerMeterPerSqrtHz[0][0]
  const plane = base.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] - own
  assert.ok(plane > 0)
  assert.ok(
    Math.abs(
      mixed.conductorSkinResistanceOhmsPerMeterPerSqrtHz[0][0] / own - 1,
    ) < 1e-5,
  )
  assert.ok(
    Math.abs(
      (mixed.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] - own) / plane - 2,
    ) < 1e-5,
  )
  assert.deepEqual(
    mixed.dcResistanceOhmsPerMeter,
    base.dcResistanceOhmsPerMeter,
  )
})

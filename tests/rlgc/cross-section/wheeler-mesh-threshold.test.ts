import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, calculateRlgc } from "../../../src/rlgc"

test("halving Wheeler recession at an adaptive mesh threshold preserves both skin terms", () => {
  // Width is exactly six lower-plane clearances, where adaptive face counts increase.
  const crossSection: CrossSection = {
    conductors: [
      {
        conductorId: "s",
        xMm: 0,
        zMm: 0.125,
        widthMm: 0.75,
        thicknessMm: 0.035,
      },
    ],
    planes: [{ zMm: 0 }],
    dielectricLayers: [],
  }
  const full = calculateRlgc({ crossSection })
  const half = calculateRlgc({
    crossSection,
    options: { recessionFraction: 0.005 },
  })
  assert.ok(
    Math.abs(
      half.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] /
        full.totalSkinResistanceOhmsPerMeterPerSqrtHz[0][0] -
        1,
    ) < 0.001,
  )
  assert.ok(
    Math.abs(
      half.conductorSkinResistanceOhmsPerMeterPerSqrtHz[0][0] /
        full.conductorSkinResistanceOhmsPerMeterPerSqrtHz[0][0] -
        1,
    ) < 0.001,
  )
})

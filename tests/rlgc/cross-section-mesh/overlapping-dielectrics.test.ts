import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("rejects overlapping dielectric layers", () => {
  const crossSection = crossSectionFixture({ kind: "mask", count: 2 })
  const overlappingLayers = [
    ...crossSection.dielectricLayers,
    crossSection.dielectricLayers[0],
  ]
  assert.throws(
    () =>
      calculateRlgc({
        crossSection: { ...crossSection, dielectricLayers: overlappingLayers },
      }),
    { code: "cross_section_geometry" },
  )
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("rejects a conductor touching a plane", () => {
  const crossSection = crossSectionFixture({ kind: "mask", count: 2 })
  const touchingPlane = [{ ...crossSection.conductors[0], zMm: 0 }]
  assert.throws(
    () =>
      calculateRlgc({
        crossSection: { ...crossSection, conductors: touchingPlane },
      }),
    { code: "cross_section_geometry" },
  )
})

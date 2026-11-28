import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("rejects duplicate conductor IDs", () => {
  const crossSection = crossSectionFixture({ kind: "mask", count: 2 })
  const duplicates = [crossSection.conductors[0], crossSection.conductors[0]]
  assert.throws(
    () =>
      calculateRlgc({
        crossSection: { ...crossSection, conductors: duplicates },
      }),
    { code: "cross_section_geometry" },
  )
})

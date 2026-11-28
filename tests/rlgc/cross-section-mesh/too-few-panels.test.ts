import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("requires enough panels per edge", () => {
  const crossSection = crossSectionFixture({ kind: "mask", count: 2 })
  assert.throws(
    () => calculateRlgc({ crossSection, options: { panelsPerEdge: 1 } }),
    { code: "cross_section_options" },
  )
})

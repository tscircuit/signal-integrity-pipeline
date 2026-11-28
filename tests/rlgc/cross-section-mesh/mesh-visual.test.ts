import { test } from "bun:test"
import { crossSectionFixture } from "../../fixtures/cross-section"
import { drawCrossSection } from "../../fixtures/cross-section-drawing"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"

test("draws the graded boundary mesh of a masked microstrip pair", () => {
  const crossSection = crossSectionFixture({ kind: "mask", count: 2 })
  const drawing = drawCrossSection({
    crossSection,
    halfWidthMm: 2.1,
    title: "Masked microstrip · boundary mesh detail",
  })
  assertPlanDrawingSnapshot({
    drawing,
    module: "rlgc",
    name: "masked-microstrip-mesh",
    trimTrailingWhitespace: true,
  })
})

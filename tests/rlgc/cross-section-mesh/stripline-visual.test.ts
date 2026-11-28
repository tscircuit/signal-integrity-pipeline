import { test } from "bun:test"
import { renderCrossSectionConductor } from "../../fixtures/cross-section-board"
import { drawCrossSection } from "../../fixtures/cross-section-drawing"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"

test("draws a translated stripline in its local reference frame", async () => {
  const conductor = await renderCrossSectionConductor({
    zMm: 1.3,
    widthMm: 1,
    thicknessMm: 0.4,
  })
  const drawing = drawCrossSection({
    crossSection: {
      conductors: [conductor],
      planes: [{ zMm: 0.5 }, { zMm: 2.5 }],
      dielectricLayers: [
        {
          zMm: 0.5,
          thicknessMm: 1,
          relativePermittivity: 4,
          lossTangent: 0.02,
        },
        {
          zMm: 1.5,
          thicknessMm: 1,
          relativePermittivity: 3,
          lossTangent: 0.01,
        },
      ],
    },
    halfWidthMm: 2.1,
    title: "Layered stripline · boundary mesh detail",
  })
  assertPlanDrawingSnapshot({
    drawing,
    module: "rlgc",
    name: "layered-stripline-mesh",
    trimTrailingWhitespace: true,
  })
})

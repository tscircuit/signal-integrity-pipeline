import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRegionPanels } from "../../../src/rlgc/cross-section-mesh"
import { partitionCrossSection } from "../../../src/rlgc/cross-section-regions"
import { validateCrossSection } from "../../../src/rlgc/cross-section-validation"
import { renderCrossSectionConductor } from "../../fixtures/cross-section-board"

test("meshes both dielectric interfaces of an air gap thinner than the probe", async () => {
  const conductor = await renderCrossSectionConductor({
    zMm: 1,
    widthMm: 0.4,
    thicknessMm: 0.035,
  })
  const gapBottomMm = 0.5
  const gapTopMm = gapBottomMm + 1e-9
  const dielectric = { relativePermittivity: 4, lossTangent: 0 }
  const crossSection = {
    conductors: [conductor],
    planes: [{ zMm: 0 }],
    dielectricLayers: [
      { ...dielectric, zMm: 0, thicknessMm: gapBottomMm },
      { ...dielectric, zMm: gapTopMm, thicknessMm: 1 - gapTopMm },
    ],
  }
  validateCrossSection(crossSection)
  const [{ region }] = partitionCrossSection(crossSection)
  const panels = buildRegionPanels({
    region,
    panelsPerEdge: 6,
    interfaceExtent: 4,
  })
  assert.deepEqual(
    new Set(
      panels
        .filter((panel) => panel.centerZMm === gapBottomMm)
        .map((panel) => panel.permittivityContrast),
    ),
    new Set([1.2]),
  )
  assert.deepEqual(
    new Set(
      panels
        .filter((panel) => panel.centerZMm === gapTopMm)
        .map((panel) => panel.permittivityContrast),
    ),
    new Set([-1.2]),
  )
})

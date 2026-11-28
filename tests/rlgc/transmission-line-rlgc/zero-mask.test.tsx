import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildCrossSection } from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("zero soldermask leaves the outer copper band and overcoat in air", async () => {
  const {
    copperGeometry: { geometry },
  } = await renderTransmissionLineRlgcInput()
  const wireSection = geometry.sections[0]
  const outerCopper = geometry.stackup.copperLayers.find(
    (layer) => layer.name === "top",
  )
  assert(outerCopper)
  const crossSection = buildCrossSection({
    geometry,
    wireSection,
    materials: {
      maskThicknessMm: 0,
      maskRelativePermittivity: 3.3,
      maskLossTangent: 0.025,
      laminateLossTangent: 0.02,
    },
  })
  assert(
    crossSection.dielectricLayers.every(
      (layer) => layer.zMm + layer.thicknessMm <= outerCopper.zMinMm + 1e-12,
    ),
  )
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { calculateCapacitanceMatrix } from "../../../src/rlgc"
import { renderCrossSectionConductor } from "../../fixtures/cross-section-board"

test("capacitance is invariant to dielectric layers that only differ in loss", async () => {
  const conductor = await renderCrossSectionConductor({
    zMm: 0.25,
    widthMm: 0.4,
    thicknessMm: 0.5,
  })
  const dielectric = { relativePermittivity: 4, lossTangent: 0.01 }
  const crossSection = {
    conductors: [conductor],
    planes: [{ zMm: 0 }, { zMm: 1 }],
    dielectricLayers: [{ ...dielectric, zMm: 0, thicknessMm: 1 }],
  }
  const uniformCapacitance = calculateCapacitanceMatrix({ crossSection })
  const splitCapacitance = calculateCapacitanceMatrix({
    crossSection: {
      ...crossSection,
      dielectricLayers: [
        { ...dielectric, zMm: 0, thicknessMm: 0.001 },
        { ...dielectric, zMm: 0.001, thicknessMm: 0.499, lossTangent: 0.02 },
        { ...dielectric, zMm: 0.5, thicknessMm: 0.5 },
      ],
    },
  })
  assert.deepEqual(splitCapacitance, uniformCapacitance)
})

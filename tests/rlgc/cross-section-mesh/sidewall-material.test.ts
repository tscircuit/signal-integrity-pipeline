import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRegionPanels } from "../../../src/rlgc/cross-section-mesh"
import { partitionCrossSection } from "../../../src/rlgc/cross-section-regions"

test("splits both conductor sidewalls at a dielectric boundary", () => {
  const [{ region }] = partitionCrossSection({
    conductors: [
      { conductorId: "s", xMm: 0, zMm: 0.8, widthMm: 1, thicknessMm: 0.4 },
    ],
    planes: [{ zMm: 0 }, { zMm: 2 }],
    dielectricLayers: [
      { zMm: 0, thicknessMm: 1, relativePermittivity: 4, lossTangent: 0.02 },
      { zMm: 1, thicknessMm: 1, relativePermittivity: 3, lossTangent: 0.01 },
    ],
  })
  const panels = buildRegionPanels({
    region,
    panelsPerEdge: 12,
    interfaceExtent: 24,
  })
  for (const side of [-1, 1]) {
    const sidewall = panels.filter(
      (panel) => panel.conductorIndex === 0 && panel.tangentZ === side,
    )
    assert.equal(sidewall.length, 8)
    assert.deepEqual(
      new Set(sidewall.map((panel) => panel.relativePermittivity)),
      new Set([3, 4]),
    )
    for (const panel of sidewall)
      assert.equal(panel.relativePermittivity, panel.centerZMm < 1 ? 4 : 3)
  }
})

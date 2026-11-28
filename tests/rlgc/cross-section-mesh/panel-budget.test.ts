import { test } from "bun:test"
import assert from "node:assert/strict"
import { buildRegionPanels } from "../../../src/rlgc/cross-section-mesh"
import { partitionCrossSection } from "../../../src/rlgc/cross-section-regions"
import { crossSectionFixture } from "../../fixtures/cross-section"

test("rejects meshes exceeding the region budget before creating panels", () => {
  const crossSection = crossSectionFixture({ kind: "stripline" })
  const [{ region }] = partitionCrossSection(crossSection)
  const [conductor] = region.conductors
  const closePlane = { ...region, conductors: [{ ...conductor, zMm: 0.001 }] }
  assert.throws(
    () =>
      buildRegionPanels({ region, panelsPerEdge: 2000, interfaceExtent: 24 }),
    {
      code: "mesh_panel_limit",
      message: /panel limit/i,
    },
  )
  assert.throws(
    () =>
      buildRegionPanels({
        region: closePlane,
        panelsPerEdge: 12,
        interfaceExtent: 24,
      }),
    { code: "mesh_panel_limit", message: /panel limit/i },
  )
})

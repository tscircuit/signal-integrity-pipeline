import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  buildCrossSection,
  TransmissionLineRlgcSolver,
} from "../../../src/rlgc"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"
import { drawCrossSection } from "../../fixtures/cross-section-drawing"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"

test("keeps lossy laminate under a projected upper reference", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" startLayer="bottom" />,
    reference: (
      <copperpour
        connectsTo="net.GND"
        layer="top"
        unbroken
        outline={[
          { x: -5, y: -1 },
          { x: 0, y: -1 },
          { x: 0, y: 0.25 },
          { x: 5, y: 0.25 },
          { x: 5, y: 2 },
          { x: -5, y: 2 },
        ]}
      />
    ),
  })
  const copperGeometry = solveBoardCopperGeometry(
    getCopperGeometryExtractionInput({ circuit }),
  )
  const solver = new TransmissionLineRlgcSolver({
    copperGeometry,
    artifactPrefix: "test",
  })
  solver.solve()
  const { solvedWireSections } = solver.getOutput().value
  const edgeSection = solvedWireSections.find(({ references }) =>
    references.some(({ lateralGapMm }) => lateralGapMm !== undefined),
  )
  assert(edgeSection)
  const [reference] = edgeSection.references
  assert.equal(edgeSection.references.length, 1)
  assert.equal(reference.layer, "top")
  assert(reference.lateralGapMm !== undefined && reference.lateralGapMm > 0)
  assert.equal(edgeSection.wires[0].layer, "bottom")

  const crossSection = buildCrossSection({
    geometry: copperGeometry.geometry,
    wireSection: edgeSection,
    materials: solver.materials,
  })
  const { stackup } = copperGeometry.geometry
  const bottomCopper = stackup.copperLayers.find(
    ({ name }) => name === "bottom",
  )
  const topCopper = stackup.copperLayers.find(({ name }) => name === "top")
  assert(bottomCopper && topCopper)
  const { maskThicknessMm, maskRelativePermittivity, maskLossTangent } =
    solver.materials
  const bottomMask = {
    zMm: bottomCopper.zMinMm - maskThicknessMm,
    thicknessMm: bottomCopper.zMaxMm - bottomCopper.zMinMm + maskThicknessMm,
    relativePermittivity: maskRelativePermittivity,
    lossTangent: maskLossTangent,
  }

  const solidSection = solvedWireSections.find(({ references }) =>
    references.some(({ lateralGapMm }) => lateralGapMm === undefined),
  )
  assert(solidSection)
  assert.equal(solidSection.references.length, 1)
  assert.equal(solidSection.references[0].surfaceZMm, topCopper.zMinMm)
  const solidCrossSection = buildCrossSection({
    geometry: copperGeometry.geometry,
    wireSection: solidSection,
    materials: solver.materials,
  })
  const [solidBottomMask, ...laminateLayers] =
    solidCrossSection.dielectricLayers
  assert.deepEqual(solidBottomMask, bottomMask)
  assert(laminateLayers.length > 0)
  const topLaminate = laminateLayers.at(-1)
  assert(topLaminate)
  assert.equal(topLaminate.lossTangent, solver.materials.laminateLossTangent)
  assert.equal(topLaminate.zMm + topLaminate.thicknessMm, topCopper.zMinMm)

  assert(reference.surfaceZMm > topCopper.zMinMm)
  const [edgeBottomMask, ...edgeLayers] = crossSection.dielectricLayers
  assert.deepEqual(edgeBottomMask, bottomMask)
  assert.deepEqual(edgeLayers.slice(0, laminateLayers.length), laminateLayers)
  const [edgeTopMask] = edgeLayers.slice(laminateLayers.length)
  assert(edgeTopMask)
  assert.equal(edgeTopMask.zMm, topCopper.zMinMm)
  assert.equal(
    edgeTopMask.zMm + edgeTopMask.thicknessMm,
    Math.min(topCopper.zMaxMm + maskThicknessMm, reference.surfaceZMm),
  )
  assert.equal(edgeTopMask.lossTangent, maskLossTangent)

  const drawing = drawCrossSection({
    crossSection,
    halfWidthMm: 1.2,
    title: "Bottom wire beside an upper reference edge",
  })
  assertPlanDrawingSnapshot({
    module: "rlgc",
    name: "upper-edge-reference",
    // Keep the title and scale without crowding the thin dielectric layers.
    drawing: { ...drawing, texts: drawing.texts?.slice(0, 2) },
    trimTrailingWhitespace: true,
  })

  const {
    capacitanceFaradsPerMeter,
    vacuumCapacitanceFaradsPerMeter,
    dielectricLossFaradsPerMeter,
  } = edgeSection.rlgcMatrices
  assert(
    capacitanceFaradsPerMeter[0][0] > 2 * vacuumCapacitanceFaradsPerMeter[0][0],
    "The laminate raises capacitance above the vacuum value",
  )
  assert(dielectricLossFaradsPerMeter[0][0] > 0)
})

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
  assertPlanDrawingSnapshot({
    module: "rlgc",
    name: "upper-edge-reference",
    drawing: drawCrossSection({
      crossSection,
      halfWidthMm: 1.2,
      title: "Bottom wire beside an upper reference edge",
    }),
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

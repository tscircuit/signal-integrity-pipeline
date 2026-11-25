import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"

test("keeps dielectric above a lower edge projected to its copper underside", async () => {
  // With the preset's 0.0994 mm gap and 0.0152 mm inner copper, the
  // projected reference lands at the underside of the inner1 copper.
  const edgeYMm = Math.sqrt(0.1146 ** 2 - 0.0994 ** 2)
  const circuit = await renderCopperGeometryBoard({
    children: <CopperTrace name="Signal" />,
    reference: (
      <copperpour
        connectsTo="net.GND"
        layer="inner1"
        unbroken
        clearance={0}
        outline={[
          { x: -5, y: edgeYMm },
          { x: 5, y: edgeYMm },
          { x: 5, y: 2 },
          { x: -5, y: 2 },
        ]}
      />
    ),
  })
  const copperGeometry = solveBoardCopperGeometry(
    getCopperGeometryExtractionInput({ circuit }),
  )
  const { geometry } = copperGeometry
  const referenceCopper = geometry.stackup.copperLayers.find(
    ({ name }) => name === "inner1",
  )
  assert(referenceCopper)
  assert.equal(geometry.sections.length, 1)
  const [section] = geometry.sections
  assert.equal(section.references.length, 1)
  const [reference] = section.references
  assert(reference.lateralGapMm !== undefined && reference.lateralGapMm > 0)
  const { zMinMm } = referenceCopper
  assert(Math.abs(reference.surfaceZMm - zMinMm) < 1e-6)

  // Use the exact coincidence in the stage input, removing core's rounding of the outline.
  const solver = new TransmissionLineRlgcSolver({
    copperGeometry: {
      ...copperGeometry,
      geometry: {
        ...geometry,
        sections: [
          { ...section, references: [{ ...reference, surfaceZMm: zMinMm }] },
        ],
      },
    },
    artifactPrefix: "test",
  })
  solver.solve()
  const [solvedSection] = solver.getOutput().value.solvedWireSections
  const { dielectricLossFaradsPerMeter } = solvedSection.rlgcMatrices
  assert(dielectricLossFaradsPerMeter[0][0] > 0)
})

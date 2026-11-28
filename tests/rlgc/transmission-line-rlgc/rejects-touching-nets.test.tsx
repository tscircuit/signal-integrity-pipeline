import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"

import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"

test("rejects touching nets", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="First" width={0.3} />
        <CopperTrace name="Other" startY={0.3} width={0.3} net="net.OTHER" />
      </>
    ),
  })
  const copperGeometry = solveBoardCopperGeometry(
    getCopperGeometryExtractionInput({ circuit }),
  )
  const solver = new TransmissionLineRlgcSolver({
    copperGeometry,
    materials: {
      maskThicknessMm: 0,
      maskRelativePermittivity: 1,
      maskLossTangent: 0,
      laminateLossTangent: 0,
    },
    artifactPrefix: "test",
  })
  assert.throws(
    () => solver.solve(),
    {
      code: "cross_section_geometry",
      message: /Conductor rectangles overlap or touch/,
    },
    "touching different nets remain an explicit failure",
  )
})

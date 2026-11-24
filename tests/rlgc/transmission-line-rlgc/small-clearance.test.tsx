import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"

test("preserves the physical clearance of nearly touching conductors", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="First" width={0.3} />
        <CopperTrace
          name="Other"
          startY={0.30000004}
          width={0.3}
          net="net.OTHER"
        />
      </>
    ),
  })
  const copper = solveBoardCopperGeometry(
    getCopperGeometryExtractionInput({ circuit }),
  )
  assert.equal(copper.geometry.sections[0].wires[1].lateralOffsetMm, 0.30000004)
  const solver = new TransmissionLineRlgcSolver({
    copperGeometry: copper,
    artifactPrefix: "test",
  })
  solver.solve()
  assert.equal(solver.getOutput().value.solvedWireSections[0].wires.length, 2)
})

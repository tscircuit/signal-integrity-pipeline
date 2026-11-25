import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  buildCrossSection,
  calculateRlgc,
  TransmissionLineRlgcSolver,
} from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("publishes frozen matrices matching direct RLGC calculation", async () => {
  const input = await renderTransmissionLineRlgcInput()
  const {
    copperGeometry: { geometry },
  } = input
  const solver = new TransmissionLineRlgcSolver(input)
  solver.solve()
  const result = solver.getOutput()
  const section = buildCrossSection({
    geometry,
    wireSection: geometry.sections[0],
    materials: solver.materials,
  })
  const direct = calculateRlgc({
    crossSection: section,
    options: { panelsPerEdge: 12 },
  })
  assert.deepEqual(
    result.value.solvedWireSections[0].rlgcMatrices.capacitanceFaradsPerMeter,
    direct.capacitanceFaradsPerMeter,
  )
  assert.ok(
    Object.isFrozen(
      result.value.solvedWireSections[0].rlgcMatrices.capacitanceFaradsPerMeter,
    ),
  )
})

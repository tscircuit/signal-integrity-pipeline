import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderRoutedCopper } from "../../fixtures/routed-copper"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"

test("publishes stackup, explicit, and assumed mask thickness provenance", async () => {
  const board = await renderRoutedCopper()
  const unmasked = solveBoardCopperGeometry(board)
  assert.equal(unmasked.maskThicknessMm, null)
  const masked = { ...unmasked, maskThicknessMm: 0.031 }
  const cases = [
    { copper: masked, source: "stackup", thicknessMm: 0.031 },
    { copper: unmasked, source: "assumed", thicknessMm: 0.02 },
    {
      copper: masked,
      materials: {
        maskThicknessMm: 0,
        maskRelativePermittivity: 3.3,
        maskLossTangent: 0.025,
        laminateLossTangent: 0.02,
      },
      source: "explicit",
      thicknessMm: 0,
    },
  ]
  for (const { copper, materials, source, thicknessMm } of cases) {
    const solver = new TransmissionLineRlgcSolver({
      copperGeometry: copper,
      materials,
      artifactPrefix: "test",
    })
    solver.solve()
    const [artifact] = solver.getOutput().artifacts
    const published = JSON.parse(artifact.body)
    assert.equal(published.materials.maskThicknessMm, thicknessMm)
    assert.equal(published.maskThicknessSource, source)
  }
})

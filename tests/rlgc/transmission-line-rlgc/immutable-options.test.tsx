import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("captures constructor options before stepping and freezes the published result", async () => {
  const input = await renderTransmissionLineRlgcInput()
  const baseline = new TransmissionLineRlgcSolver(input)
  baseline.solve()
  const materials = {
    maskThicknessMm: 0.02,
    maskRelativePermittivity: 3.3,
    maskLossTangent: 0.025,
    laminateLossTangent: 0.02,
  }
  const mutable = { ...input, materials, panelsPerEdge: 12 }
  const solver = new TransmissionLineRlgcSolver(mutable)
  solver.step()
  mutable.panelsPerEdge = 18
  materials.maskThicknessMm = 0.03
  solver.solve()
  const output = solver.getOutput()
  assert.deepEqual(output, baseline.getOutput())
  assert(Object.isFrozen(output))
  assert(Object.isFrozen(output.artifacts))
  assert(Object.isFrozen(solver.getConstructorParams()[0]))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("reuses canonical pair geometry", async () => {
  const solver = new TransmissionLineRlgcSolver(
    await renderTransmissionLineRlgcInput(),
  )
  solver.step()
  assert.equal(solver.solved, false)
  assert.equal(solver.stats.uniqueSolveCount, 1)
  solver.solve()
  const result = solver.getOutput()
  assert.equal(result.value.crossSectionSolutions.length, 1)
  assert.equal(solver.stats.cacheHitCount, 1)
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("completes the pair screen and group calculation in separate steps", async () => {
  const solver = new TransmissionLineRlgcSolver(
    await renderTransmissionLineRlgcInput(),
  )
  assert.equal(solver.MAX_ITERATIONS, Infinity)
  solver.step()
  assert.equal(solver.stats.screenedPairCount, 1)
  assert.equal(solver.stats.solvedSectionCount, 0)
  solver.step()
  assert.equal(solver.stats.solvedSectionCount, 1)
  solver.solve()
  assert.equal(solver.solved, true)
})

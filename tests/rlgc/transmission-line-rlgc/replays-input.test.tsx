import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("replays RLGC calculation from serialized constructor parameters", async () => {
  const solver = new TransmissionLineRlgcSolver(
    await renderTransmissionLineRlgcInput(),
  )
  solver.solve()
  const result = solver.getOutput()
  const repeat = new TransmissionLineRlgcSolver(
    JSON.parse(JSON.stringify(solver.getConstructorParams()[0])),
  )
  repeat.solve()
  assert.deepEqual(repeat.getOutput().artifacts, result.artifacts)
})

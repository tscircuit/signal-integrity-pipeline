import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("rejects invalid panel counts before the first solve", async () => {
  const input = await renderTransmissionLineRlgcInput()
  for (const panelsPerEdge of [2, 5, 6.5]) {
    assert.throws(
      () => new TransmissionLineRlgcSolver({ ...input, panelsPerEdge }),
      {
        code: "cross_section_options",
      },
    )
  }
})

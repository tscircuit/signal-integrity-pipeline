import { test } from "bun:test"
import assert from "node:assert/strict"
import { viaOnUnrelatedPcbTrace } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an unrelated routed barrel cannot bridge the selected copper", async () => {
  const board = await viaOnUnrelatedPcbTrace()
  assert.ok(
    board.circuit.some(
      (record) =>
        record.type === "pcb_via" && record.pcb_trace_id !== undefined,
    ),
  )
  assert.throws(() => validate(board), { code: "channel_net" })
})

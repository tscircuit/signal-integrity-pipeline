import { test } from "bun:test"
import assert from "node:assert/strict"
import { unrelatedPlatedHole } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an unrelated plated hole cannot bridge signal stubs on different layers", async () => {
  const board = await unrelatedPlatedHole()
  assert.ok(board.circuit.some((record) => record.type === "pcb_plated_hole"))
  assert.throws(() => validate(board), { code: "channel_net" })
})

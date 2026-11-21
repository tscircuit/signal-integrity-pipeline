import { test } from "bun:test"
import assert from "node:assert/strict"
import { viaInIntermediatePad } from "../../fixtures/topology-via-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a pad connects a trace to an off-center via", async () => {
  const board = await viaInIntermediatePad()
  assert.doesNotThrow(() => validate(board))
})

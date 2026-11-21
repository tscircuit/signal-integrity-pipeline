import { test } from "bun:test"
import assert from "node:assert/strict"
import { viaInDriverPad } from "../../fixtures/topology-via-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a centered via reaches the driver without a top trace", async () => {
  const board = await viaInDriverPad(0)
  assert.doesNotThrow(() => validate(board))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { inlineVia } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("an in-trace via joins the incoming and outgoing wire layers", async () => {
  const board = await inlineVia()
  assert.doesNotThrow(() => validate(board))
})

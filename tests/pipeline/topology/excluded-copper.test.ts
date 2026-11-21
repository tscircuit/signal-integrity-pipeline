import { test } from "bun:test"
import assert from "node:assert/strict"
import { railAndOtherCopper } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("rail traces and unrelated copper stay out of the signal path", async () => {
  const board = await railAndOtherCopper()
  assert.doesNotThrow(() => validate(board))
})

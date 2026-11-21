import { test } from "bun:test"
import assert from "node:assert/strict"
import { unroutedPassiveBranch } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("permissive routing does not reject ideal passive branches without routed copper", async () => {
  const board = await unroutedPassiveBranch()
  assert.doesNotThrow(() => validate({ ...board, allowUnroutedTraces: true }))
})

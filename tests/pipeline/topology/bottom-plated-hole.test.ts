import { test } from "bun:test"
import assert from "node:assert/strict"
import { rotatedPlatedHole } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("the bottom outline of a plated hole accepts off-center contact", async () => {
  const board = await rotatedPlatedHole({ layer: "bottom" })
  assert.doesNotThrow(() => validate(board))
})

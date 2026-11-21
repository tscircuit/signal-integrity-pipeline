import { test } from "bun:test"
import assert from "node:assert/strict"
import { unrelatedPlatedHole } from "../../fixtures/topology-contact-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a plated terminal on a reference rail cannot bridge the selected route", async () => {
  const board = await unrelatedPlatedHole({ rail: true })
  assert.throws(() => validate(board), { code: "channel_net" })
})

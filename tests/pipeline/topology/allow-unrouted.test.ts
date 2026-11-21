import { test } from "bun:test"
import assert from "node:assert/strict"
import { unroutedExtraPin } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("permissive routing allows an open receiver", async () => {
  const board = await unroutedExtraPin({ receiver: "STUB" })
  assert.doesNotThrow(() => validate({ ...board, allowUnroutedTraces: true }))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { missingReceiverTerminal } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("permissive routing can accept a schematic-only driver", async () => {
  const board = await missingReceiverTerminal({ missing: "driver" })
  assert.doesNotThrow(() => validate({ ...board, allowUnroutedTraces: true }))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { viaInDriverPad } from "../../fixtures/topology-via-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a via outside the driver pad does not supply a path", async () => {
  const board = await viaInDriverPad(0.8)
  assert.throws(() => validate(board), { code: "channel_net" })
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { standaloneViaRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a via can obtain its selected net through a source trace", async () => {
  const board = await standaloneViaRoute({ viaPort: "TX", offset: 0.1 })
  assert.doesNotThrow(() => validate(board))
})

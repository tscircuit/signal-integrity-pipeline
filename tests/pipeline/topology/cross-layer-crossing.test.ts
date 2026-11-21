import { test } from "bun:test"
import assert from "node:assert/strict"
import { crossingRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("tracks crossing on different layers cannot create a branch", async () => {
  const board = await crossingRoute({ thirdLayer: "bottom" })
  assert.doesNotThrow(() => validate(board))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { wireCapBoard } from "../../fixtures/topology-wire-cap-board"

test("the wire end cap and its pad contact form one junction", async () => {
  const { graph } = await wireCapBoard(0.23)
  assert.equal(Object.keys(graph).length, 2)
})

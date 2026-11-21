import { test } from "bun:test"
import assert from "node:assert/strict"
import { wireCapBoard } from "../../fixtures/topology-wire-cap-board"

test("the wire start cap and its pad contact form one junction", async () => {
  const { graph } = await wireCapBoard(-4.24)
  assert.equal(Object.keys(graph).length, 2)
})

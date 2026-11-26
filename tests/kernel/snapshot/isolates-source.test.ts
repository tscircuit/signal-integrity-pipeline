import { test } from "bun:test"
import assert from "node:assert/strict"
import { snapshot } from "../../../src/kernel"

test("snapshots isolate the source and freeze the copy", () => {
  const source = { nodes: [{ id: "n1" }] }
  const result = snapshot(source)
  source.nodes[0].id = "changed"
  assert.equal(result.nodes[0].id, "n1")
  assert.throws(() => {
    // @ts-expect-error The stage snapshot also rejects writes at compile time.
    result.nodes[0].id = "changed"
  }, TypeError)
})

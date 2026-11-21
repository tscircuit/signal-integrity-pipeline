import { test } from "bun:test"
import assert from "node:assert/strict"
import { snapshot } from "../../src/kernel"

test("snapshots isolate the source and freeze the copy", () => {
  const source = { nodes: [{ id: "n1" }] }
  const result = snapshot(source)
  source.nodes[0].id = "changed"
  assert.equal(result.nodes[0].id, "n1")
  assert.throws(() => {
    result.nodes[0].id = "changed"
  }, TypeError)
})

test("snapshots reject non-plain values", () => {
  const unsupported = [
    new Map(),
    new Set(),
    new Uint8Array(),
    new Date("2020-01-01"),
    new ArrayBuffer(0),
    () => undefined,
  ]
  for (const value of unsupported) {
    assert.throws(() => snapshot(value), /snapshots/)
  }
})

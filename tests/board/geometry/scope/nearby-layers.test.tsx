import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeNeighbors,
  scopeTrace,
} from "../../../fixtures/copper-scope-board"

test("only same-layer and adjacent routes within reach are retained", async () => {
  const { circuit, retained } = await scopeNeighbors()
  const deep = scopeTrace({ circuit, name: "DEEP" })
  const inner = deep.route.filter(
    (point) => point.route_type === "wire" && point.layer === "inner2",
  )
  assert(inner.length > 0)
  assert(inner.every((point) => "y" in point && point.y === -1))
  assert.deepEqual(retained.sort(), ["ADJACENT", "SAME", "SELECTED"])
})

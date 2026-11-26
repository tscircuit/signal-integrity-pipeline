import { test } from "bun:test"
import assert from "node:assert/strict"
import { snapshot } from "../../../src/kernel"

test("snapshot preserves null-prototype dictionaries and own keys", () => {
  const source: Record<string, string> = Object.create(null)
  source["__proto__"] = "models/vendor.ibs"
  const result = snapshot(source)
  assert.equal(Object.getPrototypeOf(result), null)
  assert.equal(result["__proto__"], "models/vendor.ibs")
  assert.equal(result.toString, undefined)
  assert.ok(Object.isFrozen(result))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { seriesResistor } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("a routed path can cross a series resistor", async () => {
  const straight = await seriesResistor({})
  assert.doesNotThrow(() => validate(straight))
})

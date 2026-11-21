import { test } from "bun:test"
import assert from "node:assert/strict"
import { padContactRoute } from "../../fixtures/topology-board"
import { validate } from "../../fixtures/validate-topology-board"

test("trace width contributes to pad contact on its layer", async () => {
  const copperContact = await padContactRoute({ offset: 0.23 })
  assert.doesNotThrow(() => validate(copperContact))
})

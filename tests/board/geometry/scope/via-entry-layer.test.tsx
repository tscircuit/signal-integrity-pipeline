import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, viaApproach } from "../../../fixtures/copper-scope-board"

test("the wire approaching a via stays on its entry layer", async () => {
  const explicit = scopeFor({
    circuit: await viaApproach({ explicitWire: true }),
  })
  const implicit = scopeFor({
    circuit: await viaApproach({ explicitWire: false }),
  })
  assert.deepEqual(explicit.pcbTraceIds, explicit.selectedPcbTraceIds)
  assert.deepEqual(implicit.pcbTraceIds, implicit.selectedPcbTraceIds)
})

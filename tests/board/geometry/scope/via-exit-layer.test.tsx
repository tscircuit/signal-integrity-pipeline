import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, viaApproach } from "../../../fixtures/copper-scope-board"

test("a wire leaving a via does not sweep its entry layer", async () => {
  const circuit = await viaApproach({
    explicitWire: false,
    selectedLayer: "top",
    exitToLeft: true,
  })
  const scope = scopeFor({ circuit })
  assert.deepEqual(scope.pcbTraceIds, scope.selectedPcbTraceIds)
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("scope rejects invalid lateral distances", async () => {
  const circuit = await renderCoreSignals(
    <board width={18} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
    </board>,
  )
  for (const distanceMm of [NaN, Infinity, -Infinity, -1]) {
    assert.throws(() => scopeFor({ circuit, distanceMm }), {
      code: "simulation_scope",
      message:
        "simulation_scope: Copper scope distance must be finite and non-negative",
    })
  }
})

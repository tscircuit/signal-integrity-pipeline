import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeFor, scopeNet } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("an explicitly selected net stays in scope without physical copper", async () => {
  const circuit = await renderCoreSignals(
    <board width={10} height={10} routeRemaining={false} schematicDisabled>
      <net name="CHANNEL" />
    </board>,
  )
  const source = scopeNet({ circuit, name: "CHANNEL" })
  const result = scopeFor({ circuit, selectedNet: "CHANNEL" })
  assert.deepEqual(result.retainedSourceIds, [source])
  assert.deepEqual(result.pcbTraceIds, [])
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  renderScopeBoard,
  scopeFor,
  Wire,
} from "../../../fixtures/copper-scope-board"

test("an elongated rectangular pad is screened using its outline", async () => {
  const circuit = await renderScopeBoard(
    <board width={20} height={20} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <chip
        name="LONG_PAD"
        pcbY={2}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["A"]}
              pcbX={0}
              pcbY={0}
              width={6}
              height={0.2}
              shape="rect"
            />
          </footprint>
        }
      />
      <Wire name="LINKED" y={6} extent={3} />
      <trace from=".LONG_PAD > .A" to=".LINKED > .A" />
    </board>,
  )
  const result = scopeFor({ circuit })
  assert.deepEqual(result.pcbTraceIds, result.selectedPcbTraceIds)
})

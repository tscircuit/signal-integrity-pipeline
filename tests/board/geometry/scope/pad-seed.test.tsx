import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  renderScopeBoard,
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"

test("a selected pad seeds proximity without a selected trace", async () => {
  const circuit = await renderScopeBoard(
    <board width={20} height={16} routeRemaining={false} schematicDisabled>
      <chip
        name="PAD"
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["A"]}
              pcbX={0}
              pcbY={0}
              shape="circle"
              radius={0.5}
            />
          </footprint>
        }
      />
      <trace from=".PAD > .A" to="net.CHANNEL" />
      <Wire name="NEAR" y={1.4} extent={5} />
      <Wire name="FAR" y={-1.8} extent={5} />
    </board>,
  )
  const result = scopeFor({ circuit, selectedNet: "CHANNEL" })
  assert.deepEqual(result.selectedPcbTraceIds, [])
  assert.deepEqual(result.pcbTraceIds, [
    scopeTrace({ circuit, name: "NEAR" }).pcb_trace_id,
  ])
})

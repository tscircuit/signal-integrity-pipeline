import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("the inclusive lateral cap measures the Euclidean gap between copper bounds", async () => {
  const circuit = await renderCoreSignals(
    <board width={24} height={16} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={1} width={0.5} />
      <Wire name="ON_BOUNDARY" y={1.5} extent={1} width={0.5} />
      <Wire name="BEYOND" y={-1.625} extent={1} width={0.5} />
      <Wire name="DIAGONAL_INSIDE" x={3.25} y={1} extent={1} width={0.5} />
      <Wire
        name="DIAGONAL_OUTSIDE"
        x={-3.375}
        y={-1.375}
        extent={1}
        width={0.5}
      />
    </board>,
  )
  const result = scopeFor({ circuit })
  assert.deepEqual(
    result.pcbTraceIds,
    ["SELECTED", "ON_BOUNDARY", "DIAGONAL_INSIDE"].map(
      (name) => scopeTrace({ circuit, name }).pcb_trace_id,
    ),
  )
})

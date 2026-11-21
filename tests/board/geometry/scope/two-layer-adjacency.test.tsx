import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("top and bottom copper are adjacent on a two-layer board", async () => {
  const circuit = await renderCoreSignals(
    <board
      width={18}
      height={16}
      layers={2}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="BOTTOM" y={0.5} extent={4} layer="bottom" />
    </board>,
  )
  const bottom = scopeTrace({ circuit, name: "BOTTOM" })
  assert(
    bottom.route.every(
      (point) => point.route_type === "wire" && point.layer === "bottom",
    ),
  )
  const scope = scopeFor({ circuit })
  assert.deepEqual(scope.pcbTraceIds, [
    ...scope.selectedPcbTraceIds,
    bottom.pcb_trace_id,
  ])
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { Circuit } from "@tscircuit/core"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"

test("an unrelated through-pad route does not prevent copper screening", async () => {
  const board = new Circuit({
    platform: { partsEngineDisabled: true, routingDrcChecksDisabled: true },
  })
  board.add(
    <board width={18} height={16} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <pcbtrace
        route={[
          { route_type: "wire", x: -4, y: 4, layer: "top", width: 0.1 },
          {
            route_type: "through_pad",
            start: { x: -4, y: 4 },
            end: { x: -3, y: 4 },
            start_layer: "top",
            end_layer: "top",
            width: 0.1,
          },
          { route_type: "wire", x: -2, y: 4, layer: "top", width: 0.1 },
        ]}
      />
    </board>,
  )
  await board.renderUntilSettled()
  const circuit = board.getCircuitJson()
  assert(
    circuit.some(
      (record) =>
        record.type === "pcb_trace" &&
        record.route.some((point) => point.route_type === "through_pad"),
    ),
  )
  const result = scopeFor({ circuit })
  assert.equal(result.selectedPcbTraceIds.length, 1)
  assert.deepEqual(result.pcbTraceIds, result.selectedPcbTraceIds)
})

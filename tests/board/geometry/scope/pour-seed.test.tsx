import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  renderScopeBoard,
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"

test("a selected-net pour seeds a neighbor beyond the selected wire's reach", async () => {
  const circuit = await renderScopeBoard(
    <board width={20} height={20} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="NEAR_POUR" y={5.8} extent={3} />
      <trace from=".SELECTED > .A" to="net.CHANNEL" />
      <copperpour
        name="CHANNEL_POUR"
        layer="top"
        connectsTo="net.CHANNEL"
        unbroken
        outline={[
          { x: -3.5, y: -0.4 },
          { x: -2.5, y: -0.4 },
          { x: -2.5, y: 5.2 },
          { x: -3.5, y: 5.2 },
        ]}
      />
    </board>,
  )
  const pour = circuit.find((record) => record.type === "pcb_copper_pour")
  assert(pour)
  const neighbor = scopeTrace({ circuit, name: "NEAR_POUR" }).pcb_trace_id
  assert(
    scopeFor({ circuit, selectedNet: "CHANNEL" }).pcbTraceIds.includes(
      neighbor,
    ),
  )
  assert(
    !scopeFor({
      circuit: circuit.filter((record) => record !== pour),
      selectedNet: "CHANNEL",
    }).pcbTraceIds.includes(neighbor),
  )
})

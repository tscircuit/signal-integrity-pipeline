import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_via } from "circuit-json"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("either explicit drill limit overrides the default through-hole span", async () => {
  for (const { channel, from, to, drill } of [
    {
      channel: "bottom",
      from: "top",
      to: "inner1",
      drill: { topmost_drill_layer: "top" },
    },
    {
      channel: "top",
      from: "inner2",
      to: "bottom",
      drill: { bottommost_drill_layer: "bottom" },
    },
  ] as const) {
    const circuit = await renderCoreSignals(
      <board
        width={18}
        height={18}
        layers={4}
        routeRemaining={false}
        schematicDisabled
      >
        <Wire name="SELECTED" y={0} extent={3} layer={channel} />
        <via
          pcbX={0}
          pcbY={0.6}
          fromLayer={from}
          toLayer={to}
          connectsTo="net.NEIGHBOR"
        />
      </board>,
    )
    const via = circuit.find((record) => record.type === "pcb_via")
    assert(via)
    assert.deepEqual(via.layers, [from, to])
    assert.deepEqual(scopeFor({ circuit }).pcbViaIds, [via.pcb_via_id])

    // Core emits connected layers but has no prop for a partial drill limit.
    const limited = pcb_via.parse({ ...via, ...drill })
    const records = circuit.map((record) => {
      if (record === via) return limited
      return record
    })
    assert.deepEqual(scopeFor({ circuit: records }).pcbViaIds, [])
  }
})

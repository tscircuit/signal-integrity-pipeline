import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_copper_pour } from "circuit-json"
import { scopeFor, Wire } from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a nearby non-reference pour retains its distant routed net", async () => {
  const circuit = await renderCoreSignals(
    <board
      width={18}
      height={18}
      layers={4}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="DISTANT" y={5} extent={3} />
      <trace from=".DISTANT > .A" to="net.NEIGHBOR" />
      <copperpour
        name="NEAR"
        layer="top"
        connectsTo="net.NEIGHBOR"
        unbroken
        outline={[
          { x: -3.4, y: 0.55 },
          { x: -2.6, y: 0.55 },
          { x: -2.6, y: 5.4 },
          { x: -3.4, y: 5.4 },
        ]}
      />
      <copperpour
        name="FAR"
        layer="top"
        connectsTo="net.NEIGHBOR"
        unbroken
        outline={[
          { x: 2.6, y: 4.6 },
          { x: 3.4, y: 4.6 },
          { x: 3.4, y: 5.4 },
          { x: 2.6, y: 5.4 },
        ]}
      />
    </board>,
  )
  const source = circuit.find(
    (record) =>
      record.type === "source_trace" && record.name === "DISTANT_route",
  )
  assert(source?.type === "source_trace")
  const route = circuit.find(
    (record) =>
      record.type === "pcb_trace" &&
      record.source_trace_id === source.source_trace_id,
  )
  assert(route?.type === "pcb_trace")
  const result = scopeFor({ circuit })
  assert(result.pcbTraceIds.includes(route.pcb_trace_id))

  // Move the rendered pours two stack indices below the channel.
  const deeper = circuit.map((record) => {
    if (record.type !== "pcb_copper_pour") return record
    return pcb_copper_pour.parse({ ...record, layer: "inner2" })
  })
  assert(
    !scopeFor({ circuit: deeper }).pcbTraceIds.includes(route.pcb_trace_id),
  )
})

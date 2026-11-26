import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a trace cycle diagnostic excludes the attached load tail", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <DaisyChainFixture routeFinalLeg bypassFinalLeg placedLoad="mapped" />
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const db = cju([...circuitJson])
  const load = db.source_component.getWhere({ name: "LOAD" })
  assert.ok(load)
  const port = db.source_port.getWhere({
    source_component_id: load.source_component_id,
    name: "pin1",
  })
  assert.ok(port)
  const tail = bindings.traceContacts.find(
    ({ fromSourcePortId, toSourcePortId }) =>
      fromSourcePortId === port.source_port_id ||
      toSourcePortId === port.source_port_id,
  )
  assert.ok(tail)
  const cycle = bindings.traceContacts.filter((contacts) => contacts !== tail)
  assert.equal(cycle.length, 2)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, "channel_short")
      for (const contacts of cycle) {
        assert.ok(error.message.includes(contacts.sourceTraceId))
        assert.ok(error.message.includes(contacts.fromSourcePortId))
        assert.ok(error.message.includes(contacts.toSourcePortId))
      }
      assert.ok(!error.message.includes(tail.sourceTraceId))
      return true
    },
  )
})

import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson, selectPort } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("rejects an ideal bypass across a receiver-side trace and series resistor", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <ChannelFixture route="series">
        <trace from=".RS > .pin1" to=".RX > .A" />
        <pcbnotetext
          text="Ideal RS.pin1 to RX.A bypasses RS + right trace"
          fontSize={0.45}
          pcbX={0}
          pcbY={4.8}
        />
      </ChannelFixture>
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
  const { traceContacts } = bindings
  const from = selectPort({
    circuit: circuitJson,
    selector: { component: "RS", port: "pin2" },
  })
  const to = selectPort({
    circuit: circuitJson,
    selector: { component: "RX", port: "A" },
  })
  const contacts = traceContacts.find(
    ({ fromSourcePortId, toSourcePortId }) =>
      fromSourcePortId === from.source_port_id &&
      toSourcePortId === to.source_port_id,
  )
  assert.ok(contacts)
  assert.equal(traceContacts.length, 2)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    {
      code: "channel_short",
      message: new RegExp(
        `${contacts.sourceTraceId}.*${contacts.fromSourcePortId}.*${contacts.toSourcePortId}`,
      ),
    },
  )
})

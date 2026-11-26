import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson, selectPort } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("rejects an ideal bypass across a driver-side trace and series resistor", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <ChannelFixture route="series">
        <trace from=".TX > .Y" to=".RS > .pin2" />
        <pcbnotetext
          text="Ideal TX.Y to RS.pin2 bypasses left trace + RS"
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
    selector: { component: "TX", port: "Y" },
  })
  const to = selectPort({
    circuit: circuitJson,
    selector: { component: "RS", port: "pin1" },
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

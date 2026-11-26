import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("ground shunts do not create a bypass across a single-ended load trace", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <ChannelFixture route="unrouted">
        <resistor
          name="RSHUNT"
          resistance="10k"
          footprint="0402"
          pcbX={-3}
          pcbY={3}
          connections={{ pin1: ".TX > .Y", pin2: "net.GND" }}
        />
        <resistor
          name="RLOAD"
          resistance="10k"
          footprint="0402"
          pcbX={-1}
          pcbY={2}
          connections={{ pin2: "net.GND" }}
        />
        <trace
          from=".TX > .Y"
          to=".RLOAD > .pin1"
          pcbPath={[".TX > .Y", ".RLOAD > .pin1"]}
        />
      </ChannelFixture>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.traceContacts.length, 1)
  assert.deepEqual(bindings.receiverPaths, [])
  const [{ fromSourcePortId, toSourcePortId }] = bindings.traceContacts
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  assert.notEqual(node(fromSourcePortId), node(toSourcePortId))
})

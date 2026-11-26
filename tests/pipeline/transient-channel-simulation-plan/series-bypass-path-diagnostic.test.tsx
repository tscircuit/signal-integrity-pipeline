import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("names both contacts and every routed trace in a bypassed receiver path", async () => {
  const circuitJson = await renderSignals({
    tree: <ChannelFixture route="series" short="channel" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  const [receiverPath] = bindings.receiverPaths
  assert.equal(receiverPath.sourceTraceIds?.length, 2)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    {
      domain: "simulation",
      code: "channel_short",
      message: `channel_short: DATA: endpoints ${receiverPath.fromSourcePortId} and ${receiverPath.toSourcePortId} share an ideal group across routed path ${receiverPath.sourceTraceIds?.join(", ")}`,
    },
  )
})

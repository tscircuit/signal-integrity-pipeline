import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { Inverter } from "../../fixtures/signal-parts"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("explains a split-net failure without showing record IDs in the header", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <DaisyChainFixture routeFinalLeg namedNet>
        <Inverter name="LOAD" x={7} y={2} driver={false} />
        <trace from=".LOAD > .A" to="net.DATA" />
      </DaisyChainFixture>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "channel_fanout",
    message: /shared channel net has additional ports/,
  })
  const drawing = solver.visualize()
  const header = drawing.texts
    ?.filter(({ layer }) => layer === "header")
    .toSorted((a, b) => b.y - a.y)
    .map(({ text }) => text)
    .join(" ")
  assert.doesNotMatch(header || "", /source_(trace|port)_/)
  assert.match(header || "", /bind loads to an explicit endpoint/i)
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "split-net-failure-visual",
  })
})

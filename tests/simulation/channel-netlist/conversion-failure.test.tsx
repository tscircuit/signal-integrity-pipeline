import { test } from "bun:test"
import assert from "node:assert/strict"
import { ChannelNetlistSolver } from "../../../src/simulation"
import { renderTwoTraceNetlistInput } from "../../fixtures/channel-netlist"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("marks the netlist failed when IBIS conversion fails", async () => {
  const input = await renderTwoTraceNetlistInput()
  const solver = new ChannelNetlistSolver({
    ...input,
    ibisSources: {
      [inverterModelPath]: routedVisualIbis.replace(
        "[Component] LVC1G04_DCK",
        "[Component] Unmapped",
      ),
    },
  })
  assert.throws(() => solver.step(), { code: "missing_component" })
  assert.equal(solver.failed, true)
  assert.throws(() => solver.getOutput(), /netlist is incomplete/)
})

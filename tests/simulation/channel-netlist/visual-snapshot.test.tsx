import { test } from "bun:test"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

test("draws the compiled channel netlist on the two-trace board", async () => {
  const { root } = await routedVisualFixture()
  assertPlanDrawingSnapshot({
    drawing: root.getSolver("ChannelNetlistSolver")!.visualize(),
    module: "simulation",
    name: "channel-netlist",
  })
})

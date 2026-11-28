import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeTones } from "../../../src/board"
import type { RoutedStageSolver } from "../../../src/pipeline"
import {
  type ChannelNetlist,
  ChannelNetlistStage,
} from "../../../src/simulation"
import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../../fixtures/routed-visual"

type NetlistStageInput = ConstructorParameters<typeof ChannelNetlistStage>[0]

test("missing IBIS bytes mark physical endpoints and rejection reason red", async () => {
  const { root } = await routedVisualFixture()
  const stage = root.getSolver<
    RoutedStageSolver<NetlistStageInput, ChannelNetlist>
  >("ChannelNetlistSolver")!
  const [[input]] = stage.getConstructorParams()
  const missing = new ChannelNetlistStage({ ...input, ibisSources: {} })
  assert.throws(() => missing.solve())
  const drawing = missing.visualize()
  assert.ok(
    drawing.polygons!.some((outline) => outline.stroke === routeTones.failure),
  )
  assert.ok(
    drawing.texts!.some(
      (text) =>
        text.color === routeTones.failure && text.text.includes("model"),
    ),
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "simulation",
    name: "channel-netlist-missing",
  })
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { routeTones } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelNetlistStage } from "../../../src/simulation"
import { renderTwoTracePlanInput } from "../../fixtures/two-trace-plan-input"
import { vendorAvailable } from "../../fixtures/vendor-models"

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "draws driver and receiver glyphs on the board and strip",
  async () => {
    const planner = new TransientChannelSimulationPlanSolver(
      await renderTwoTracePlanInput(),
    )
    planner.solve()
    const [plan] = planner.getOutput().value
    const stage = new ChannelNetlistStage({
      ...plan.bindings,
      board: plan.sections,
    })
    stage.solve()
    assert.ok(Object.isFrozen(stage.getOutput().value.nodeMap))
    const glyphs = stage
      .visualize()
      .polygons!.filter((polygon) => polygon.points.length === 3)
    assert.equal(glyphs.length, 8)
    assert.equal(
      glyphs.filter((glyph) => glyph.fill !== routeTones.halo).length,
      4,
    )
  },
)

import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"

test("an empty board produces no channel simulation plans", () => {
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson: [],
    ibisSources: {},
  })
  solver.solve()
  assert.deepEqual(solver.getOutput().value, [])
})

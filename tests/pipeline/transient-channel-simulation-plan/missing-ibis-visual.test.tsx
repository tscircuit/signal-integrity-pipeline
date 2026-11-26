import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("shows which IBIS file to supply in the printed plan", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: {},
  })
  assert.throws(() => solver.solve(), { code: "ibis_asset_missing" })
  const header = solver
    .visualize()
    .texts?.filter(({ layer }) => layer === "header")
    .toSorted((a, b) => b.y - a.y)
    .map(({ text }) => text)
    .join(" ")
  assert.ok(
    header?.includes(
      `Supply IBIS bytes for ${inverterModelPath} in ibisSources`,
    ),
  )
})

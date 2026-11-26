import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("stage boards share a deeply frozen Circuit JSON snapshot", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const board = plan.sections.circuitJson
  assert.equal(board, plan.bindings.circuitJson)
  assert.ok(Object.isFrozen(board))
  const [trace] = cju([...board] as CircuitJson).pcb_trace.list()
  assert.ok(trace?.route.length)
  assert.ok(Object.isFrozen(trace))
  assert.ok(Object.isFrozen(trace.route))
  assert.ok(Object.isFrozen(trace.route[0]))
})

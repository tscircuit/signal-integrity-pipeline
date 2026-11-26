import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("rejects a PCB trace missing its own record ID", async () => {
  const circuitJson = await renderSignals({ tree: <TwoTraceBoard /> })
  const [trace] = cju([...circuitJson]).pcb_trace.list()
  assert.ok(trace)
  // Core always emits an ID; omit it only in the schema boundary payload.
  const { pcb_trace_id: pcbTraceId, ...invalidTrace } = trace
  assert.ok(pcbTraceId)
  const invalidCircuitJson = circuitJson.map((record) => {
    if (record === trace) return invalidTrace
    return record
  }) as CircuitJson
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson: invalidCircuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  assert.throws(() => solver.solve(), {
    code: "circuit_schema",
    message: /pcb_trace_id/,
  })
})

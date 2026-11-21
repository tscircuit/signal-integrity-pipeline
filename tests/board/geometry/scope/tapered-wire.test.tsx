import { test } from "bun:test"
import assert from "node:assert/strict"
import { pcb_trace } from "circuit-json"
import {
  scopeFor,
  scopeTrace,
  Wire,
} from "../../../fixtures/copper-scope-board"
import { renderCoreSignals } from "../../../support/core-render"

test("a tapered wire is admitted when its widest copper reaches the scope", async () => {
  const circuit = await renderCoreSignals(
    <board width={24} height={18} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="TAPER" y={1.35} extent={8} />
    </board>,
  )
  const trace = scopeTrace({ circuit, name: "TAPER" })
  assert(!scopeFor({ circuit }).pcbTraceIds.includes(trace.pcb_trace_id))
  // Core renders the centerline at a constant width. Add the native taper metadata.
  const tapered = pcb_trace.parse({
    ...trace,
    route_thickness_mode: "interpolated",
    route: trace.route.map((point, index) => {
      if (index !== 1) return point
      assert(point.route_type === "wire")
      return {
        ...point,
        start_width: 0.1,
        end_width: 0.9,
        width_interpolation_mode: "linear",
      }
    }),
  })
  const records = circuit.map((record) => {
    if (record === trace) return tapered
    return record
  })
  assert(
    scopeFor({ circuit: records }).pcbTraceIds.includes(trace.pcb_trace_id),
  )
})

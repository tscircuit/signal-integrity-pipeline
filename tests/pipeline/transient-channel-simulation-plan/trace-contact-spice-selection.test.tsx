import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { generalDeclarations } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a trace contact outside a receiver path needs a passive selected for the deck", async () => {
  const circuitJson = await renderSignals({
    tree: <DaisyChainFixture routeFinalLeg placedLoad="mapped" />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [plan] = solver.getOutput().value
  const { bindings } = plan
  assert.equal(bindings.traceContacts.length, 3)
  const load = cju(
    cloneCircuitJson(bindings.circuitJson),
  ).source_component.getWhere({
    name: "LOAD",
  })
  assert.ok(load)
  assert.ok(
    !bindings.modeling.passiveComponents?.some(
      ({ sourceComponentId }) => sourceComponentId === load.source_component_id,
    ),
  )
  assert.throws(
    () =>
      generalDeclarations({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    { domain: "simulation", code: "channel_model", message: /LOAD/ },
  )
  assert.equal(solver.visualize().title, "DAISY: plan ready")
})

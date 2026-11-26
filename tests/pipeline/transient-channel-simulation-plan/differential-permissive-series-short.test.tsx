import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("permissive routing retains the routed differential path to the short", async () => {
  const circuitJson = await renderSignals({
    tree: <Differential seriesPositive short="series" allowUnroutedTraces />,
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const db = cju([...circuitJson])
  const resistor = db.source_component.getWhere({ name: "RS1" })
  assert.ok(resistor)
  const contact = db.source_port.getWhere({
    source_component_id: resistor.source_component_id,
    name: "pin2",
  })
  assert.ok(contact)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.receiverPaths[0].sourceTraceIds?.length, 5)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    { code: "channel_short", message: new RegExp(contact.source_port_id) },
  )
})

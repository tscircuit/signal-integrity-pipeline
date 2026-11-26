import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ShuntFixture } from "../../fixtures/shunt-fixture"
import "../../fixtures/extend-expect-circuit-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("ground shunts load the partial differential path without joining it", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential partialSeriesPair allowUnroutedTraces>
        <ShuntFixture pin="A" rail="GND" />
        <pcbnotetext
          text="GND shunts load both ends of A"
          pcbX={0}
          pcbY={4.8}
        />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.receiverPaths[0].sourceTraceIds?.length, 2)
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  const db = cju(cloneCircuitJson(bindings.circuitJson))
  for (const name of ["RSHUNT_TX_A", "RSHUNT_RX_A"]) {
    const component = db.source_component.getWhere({ name })
    assert.ok(component)
    const sourceComponentId = component.source_component_id
    assert.ok(
      bindings.modeling.passiveComponents?.some(
        (selection) => selection.sourceComponentId === sourceComponentId,
      ),
    )
    const ground = db.source_port.getWhere({
      source_component_id: sourceComponentId,
      name: "pin2",
    })
    assert.ok(ground)
    assert.equal(node(ground.source_port_id), "0")
  }
})

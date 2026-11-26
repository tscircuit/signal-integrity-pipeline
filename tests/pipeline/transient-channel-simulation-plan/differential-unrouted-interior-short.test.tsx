import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import "../../fixtures/extend-expect-circuit-snapshot"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("binding rejects an ideal short between unrouted differential interiors", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential partialSeriesPair short="interior" allowUnroutedTraces />
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const db = cju([...circuitJson])
  const [positive, negative] = ["RA1", "RB1"].map((name) => {
    const resistor = db.source_component.getWhere({ name })
    assert.ok(resistor)
    const contact = db.source_port.getWhere({
      source_component_id: resistor.source_component_id,
      name: "pin2",
    })
    assert.ok(contact)
    return contact.source_port_id
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.deepEqual(
    bindings.receiverPaths.map(({ sourceTraceIds }) => sourceTraceIds?.length),
    [2, 2],
  )
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    {
      code: "channel_short",
      message: new RegExp(`${negative}.*${positive}`),
    },
  )
})

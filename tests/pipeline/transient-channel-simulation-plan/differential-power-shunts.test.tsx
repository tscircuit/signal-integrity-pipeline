import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { differentialIbis } from "../../fixtures/routed-visual-fixture"
import { ShuntFixture } from "../../fixtures/shunt-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import Differential from "../../fixtures/unit-differential"

test("pull-ups on both differential legs keep their signal nodes distinct", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <Differential partialSeriesPair allowUnroutedTraces>
        <ShuntFixture pin="A" rail="VCC" />
        <ShuntFixture pin="B" rail="VCC" />
      </Differential>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn65hvd72.ibs": differentialIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  const { node } = circuitNodes({
    ...bindings,
    circuit: cloneCircuitJson(bindings.circuitJson),
  })
  const [positive, negative] = bindings.receiverPaths
  assert.equal(positive.sourceTraceIds?.length, 2)
  assert.equal(negative.sourceTraceIds?.length, 2)
  assert.notEqual(
    node(positive.fromSourcePortId),
    node(negative.fromSourcePortId),
  )
  assert.notEqual(node(positive.toSourcePortId), node(negative.toSourcePortId))
})

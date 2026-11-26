import { test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { generalDeclarations } from "../../../src/simulation"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("a modeled endpoint beyond the receiver needs its own run state", async () => {
  const circuitJson = await renderCoreSignals(
    <DaisyChainFixture routeFinalLeg />,
  )
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings, sections, simulationPcbTransientChannelSimulationId }] =
    solver.getOutput().value
  const receiverPorts = bindings.receiverPaths.flatMap(
    ({ fromSourcePortId: from, toSourcePortId: to }) => [from, to],
  )
  const loadSourcePortId = sections.requiredSourcePortIds.find(
    (port) => !receiverPorts.includes(port),
  )
  assert.ok(loadSourcePortId)
  const { states, stimuli } =
    bindings.controls[simulationPcbTransientChannelSimulationId]
  assert.ok(
    states.some(({ source_port_id }) => source_port_id === loadSourcePortId),
  )
  assert.throws(
    () =>
      generalDeclarations({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
        controls: {
          [simulationPcbTransientChannelSimulationId]: {
            states: states.filter(
              ({ source_port_id }) => source_port_id !== loadSourcePortId,
            ),
            stimuli: [...stimuli],
          },
        },
      }),
    { domain: "simulation", code: "channel_model" },
  )
})

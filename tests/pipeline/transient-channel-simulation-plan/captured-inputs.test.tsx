import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import React from "react"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../../src/board"
import { sha256 } from "../../../src/kernel"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { listChannelSimulations } from "../../../src/pipeline/signals"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

/** Render a second declaration with its own name on the same board. */
function renderTwoChannelSimulations(
  channelSimulationName: string,
): Promise<CircuitJson> {
  const board = TwoTraceBoard()
  return renderCoreSignals(
    React.cloneElement(
      board,
      {},
      <>
        {board.props.children}
        <simulation.pcbtransientchannelsimulation
          name={channelSimulationName}
          bitRate="50Mbps"
          aggressorPattern="0"
        >
          <simulation.pcbdriverreceiverchannel
            name="ALT_DATA"
            driverRef=".TX0 > .Y"
            receiverRef=".RX0 > .A"
          />
        </simulation.pcbtransientchannelsimulation>
      </>,
    ),
  )
}

test("all channel simulations and the manifest use the same captured inputs", async () => {
  const circuitJson = await renderTwoChannelSimulations("ALT")
  const ibisSources = { [inverterModelPath]: routedVisualIbis }
  const input = { circuitJson, ibisSources, nearbyGapMm: 1 }
  const solver = new TransientChannelSimulationPlanSolver(input)
  solver.step()
  assert.equal(solver.solved, false)
  ibisSources[inverterModelPath] += "| Modified after the first step\n"
  const originalChannelSimulation = listChannelSimulations(circuitJson)[1]
  const replacementCircuit = await renderTwoChannelSimulations("Changed")
  const replacementChannelSimulation =
    listChannelSimulations(replacementCircuit)[1]
  circuitJson[circuitJson.indexOf(originalChannelSimulation)] =
    replacementChannelSimulation
  const [capturedInput] = solver.getConstructorParams()
  assert.notEqual(
    listChannelSimulations(capturedInput.circuitJson)[1],
    originalChannelSimulation,
  )
  input.nearbyGapMm = 2
  solver.step()
  const {
    value: plans,
    artifacts: [manifest],
  } = solver.getOutput()
  assert.deepEqual(
    plans.map((plan) => plan.bindings.ibisSources[inverterModelPath]),
    [routedVisualIbis, routedVisualIbis],
  )
  assert.deepEqual(
    plans.map((plan) => plan.name),
    ["TWO", "ALT"],
  )
  assert.deepEqual(
    plans.map((plan) => plan.sections.copperScope.nearbyGapMm),
    [1, 1],
  )
  assert.equal(
    JSON.parse(manifest.body).models[inverterModelPath],
    sha256(routedVisualIbis),
  )
})

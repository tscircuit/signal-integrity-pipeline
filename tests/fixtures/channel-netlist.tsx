import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../src/board"
import {
  type TransientChannelSimulationPlan,
  TransientChannelSimulationPlanSolver,
} from "../../src/pipeline"
import type { ChannelNetlistInput } from "../../src/simulation"
import { renderCoreSignals } from "../support/core-render"
import { routedVisualIbis } from "./routed-visual-fixture"
import { inverterModelPath } from "./two-trace-plan-input"

/** Plan a rendered board using synthetic IBIS text. */
export function planNetlistChannels({
  circuitJson,
  ibisText = routedVisualIbis,
}: {
  circuitJson: CircuitJson
  ibisText?: string
}): readonly TransientChannelSimulationPlan[] {
  const planner = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: ibisText },
    nearbyGapMm: 1,
  })
  planner.solve()
  return planner.getOutput().value
}

/** Render and plan a board with two routed channels. */
export async function renderTwoTraceNetlistInput(): Promise<ChannelNetlistInput> {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  return planNetlistChannels({ circuitJson })[0].bindings
}

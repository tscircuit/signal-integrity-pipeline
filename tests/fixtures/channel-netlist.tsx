import assert from "node:assert/strict"
import type { cju } from "@tscircuit/circuit-json-util"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { CircuitJson, SourcePortId } from "../../src/board"
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

/** Resolve a physical pin of a named component in a rendered fixture. */
export function fixturePortId({
  db,
  component,
  pin,
}: {
  db: ReturnType<typeof cju>
  component: string
  pin: number
}): SourcePortId {
  const part = db.source_component.getWhere({ name: component })
  assert.ok(part)
  const port = db.source_port.getWhere({
    source_component_id: part.source_component_id,
    pin_number: pin,
  })
  assert.ok(port)
  return port.source_port_id
}

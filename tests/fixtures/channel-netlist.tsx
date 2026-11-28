import assert from "node:assert/strict"
import type { cju } from "@tscircuit/circuit-json-util"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { SourcePortId } from "../../src/board"
import type { ChannelNetlistInput } from "../../src/simulation"
import { renderCoreSignals } from "../support/core-render"
import { routedVisualIbis } from "./routed-visual-fixture"
import { plannedBindings } from "./signal-render"
import { inverterModelPath } from "./two-trace-plan-input"

/** Render and plan a board with two routed channels. */
export async function renderTwoTraceNetlistInput(): Promise<ChannelNetlistInput> {
  return plannedBindings({
    circuitJson: await renderCoreSignals(<TwoTraceBoard data-pattern="10" />),
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
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

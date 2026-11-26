import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { cloneCircuitJson } from "../../../src/board"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { circuitNodes } from "../../../src/simulation"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import "../../fixtures/extend-expect-circuit-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"

test("a pre-existing routed loop has a routed topology diagnostic", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <ChannelFixture route="unrouted">
        <resistor
          name="R1"
          resistance="33"
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.3}
                height={0.3}
                shape="rect"
              />
            </footprint>
          }
          pcbX={-2}
          pcbY={1.5}
        />
        <resistor
          name="R2"
          resistance="33"
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.3}
                height={0.3}
                shape="rect"
              />
            </footprint>
          }
          pcbX={2}
          pcbY={1.5}
        />
        <resistor
          name="R3"
          resistance="33"
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.3}
                height={0.3}
                shape="rect"
              />
            </footprint>
          }
          pcbY={3}
        />
        <trace from=".TX > .Y" to=".R1 > .pin1" />
        <trace
          from=".R1 > .pin1"
          to=".R2 > .pin1"
          pcbPath={[".R1 > .pin1", ".R2 > .pin1"]}
        />
        <trace
          from=".R2 > .pin1"
          to=".R3 > .pin1"
          pcbPath={[".R2 > .pin1", ".R3 > .pin1"]}
        />
        <trace
          from=".R3 > .pin1"
          to=".R1 > .pin1"
          pcbPath={[".R3 > .pin1", ".R1 > .pin1"]}
        />
      </ChannelFixture>
    ),
    expectedErrors: ["pcb_trace_missing_error", "pcb_port_not_connected_error"],
  })
  expect(circuitJson).toMatchPcbSnapshot(import.meta.path)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  solver.solve()
  const [{ bindings }] = solver.getOutput().value
  assert.equal(bindings.traceContacts.length, 3)
  assert.throws(
    () =>
      circuitNodes({
        ...bindings,
        circuit: cloneCircuitJson(bindings.circuitJson),
      }),
    {
      domain: "simulation",
      code: "channel_fanout",
      message: /Routed traces form a loop/,
    },
  )
  const drawing = solver.visualize()
  const header = drawing.texts
    ?.filter((text) => text.layer === "header")
    .sort((a, b) => b.y - a.y)
    .map(({ text }) => text)
    .join(" ")
  assert.match(header || "", /form a loop\./)
  assert.equal(
    drawing.polygons?.filter(
      (shape) =>
        shape.layer === "failure" && shape.label?.startsWith("Fault trace"),
    ).length,
    3,
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "physical-trace-loop-visual",
    caption:
      "The three routed traces around R1, R2 and R3 form a loop. The ideal connection to TX lies outside that loop.",
  })
})

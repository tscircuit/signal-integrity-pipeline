import { test } from "bun:test"
import assert from "node:assert/strict"
import { Point, Polygon } from "@flatten-js/core"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("places the reference pour label on copper clear of an interior keepout", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <ChannelFixture route="series">
        <keepout
          shape="rect"
          layers={["bottom"]}
          pcbX={0}
          pcbY={-2.3}
          width={6}
          height={2}
        />
      </ChannelFixture>
    ),
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  const label = drawing.texts?.find(
    ({ text, layer }) =>
      text === "GND copper (bottom)" && layer === "pour labels",
  )
  assert.ok(label)
  const copper = drawing.polygons
    ?.filter(
      ({ label, fill }) =>
        label === "GND copper (bottom)" && fill && fill !== "none",
    )
    .map(({ points }) => new Polygon(points.map(({ x, y }) => new Point(x, y))))
  assert.ok(copper?.length)
  assert.ok(copper.every((shape) => !shape.contains(new Point(0, -2.3))))
  assert.ok(copper.some((shape) => shape.contains(new Point(label.x, label.y))))
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "pour-label-clearance",
  })
})

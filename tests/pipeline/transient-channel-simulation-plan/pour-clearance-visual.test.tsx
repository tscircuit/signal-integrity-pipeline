import { test } from "bun:test"
import assert from "node:assert/strict"
import { Point, Polygon } from "@flatten-js/core"
import { cju } from "@tscircuit/circuit-json-util"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { ChannelFixture } from "../../fixtures/channel-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderSignals } from "../../fixtures/signal-render"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"

test("preserves the clearance around an isolated signal via in a reference pour", async () => {
  const circuitJson = await renderSignals({
    tree: (
      <ChannelFixture route="series">
        <net name="SIGNAL" />
        <via
          pcbX={0}
          pcbY={1}
          holeDiameter={0.3}
          outerDiameter={0.5}
          connectsTo="net.SIGNAL"
          fromLayer="top"
          toLayer="bottom"
        />
      </ChannelFixture>
    ),
    expectedErrors: ["pcb_port_not_connected_error"],
  })
  const db = cju([...circuitJson])
  const pour = db.pcb_copper_pour.getWhere({ layer: "bottom" })
  assert.ok(pour?.shape === "brep" && pour.brep_shape.inner_rings.length)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: routedVisualIbis },
  })
  solver.solve()
  const drawing = solver.visualize()
  const fill = drawing.polygons?.filter(
    ({ label, fill }) =>
      label === "GND copper (bottom)" && fill && fill !== "none",
  )
  assert.ok(fill?.length)
  const copper = fill.map(
    ({ points }) => new Polygon(points.map(({ x, y }) => new Point(x, y))),
  )
  assert.ok(copper.some((shape) => shape.contains(new Point(2, 1))))
  assert.ok(copper.every((shape) => !shape.contains(new Point(0, 1))))
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "pour-clearance-visual",
  })
})

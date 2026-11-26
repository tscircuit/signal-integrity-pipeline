import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { DaisyChainFixture } from "../../fixtures/daisy-chain-fixture"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { renderCoreSignals } from "../../support/core-render"

test("draws the receiver path and extra trace on a daisy chain", async () => {
  const circuitJson = await renderCoreSignals(
    <DaisyChainFixture routeFinalLeg />,
  )
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson,
    ibisSources: { "models/sn74lvc1g04.ibs": routedVisualIbis },
  })
  assert.ok(
    solver.visualize().polygons?.some((polygon) => polygon.label === "board"),
  )
  solver.solve()
  const { value, artifacts } = solver.getOutput()
  assert.equal(value.length, 1)
  const [{ name, sections, bindings }] = value
  assert.equal(name, "DAISY")
  assert.equal(sections.copperScope.channelPcbTraceIds.length, 2)
  const [receiverPath] = bindings.receiverPaths
  assert.equal(bindings.receiverPaths.length, 1)
  assert.equal(receiverPath.channelName, "DATA")
  assert.ok(
    bindings.traceContacts.some(
      (contacts) =>
        contacts.sourceTraceId === receiverPath.sourceTraceId &&
        contacts.fromSourcePortId === receiverPath.fromSourcePortId &&
        contacts.toSourcePortId === receiverPath.toSourcePortId,
    ),
  )
  assert.equal(bindings.traceContacts.length, 2)
  assert.equal(artifacts[0].path, "transient-channel-simulation-plan.json")
  const drawing = solver.visualize()
  const header = drawing.texts?.filter((text) => text.layer === "header")
  assert.equal(
    drawing.polygons?.filter(
      (shape) => shape.layer === "endpoints" && shape.label?.includes("Driver"),
    ).length,
    2,
  )
  assert.ok(
    drawing.polygons?.some((shape) =>
      shape.label?.includes("Extra trace end · RX.A"),
    ),
  )
  assert.ok(drawing.lines?.some((line) => line.layer === "scope"))
  assert.ok(header?.every((text) => text.anchorSide === "center" && text.y > 6))
  assert.ok(
    drawing.texts?.some((text) =>
      text.text.includes("Extra trace: MID pin A → RX pin A (top, 5 mm)"),
    ),
  )
  assert.equal(drawing.title, "DAISY: plan ready")
  assert.equal(header?.length, 6)
  assert.deepEqual(
    drawing.texts
      ?.filter((text) => text.layer === "pin labels")
      .map(({ text }) => text)
      .sort(),
    ["MID pin A", "RX pin A", "TX pin Y"],
  )
  assert.deepEqual(
    drawing.texts
      ?.filter((text) => text.layer === "part labels")
      .map(({ text }) => text)
      .sort(),
    ["MID", "RX", "TX"],
  )
  assertPlanDrawingSnapshot({
    drawing,
    module: "pipeline/transient-channel-simulation-plan",
    name: "scoped-copper-visual",
    caption:
      "One trace runs from TX to MID and another continues to RX, which is not a receiver. This test checks that the plan still includes the extra trace to RX.",
  })
})

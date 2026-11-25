import { test } from "bun:test"
import assert from "node:assert/strict"
import { TwoTraceBoard } from "../../../examples/routed/two-trace-board"
import { sha256 } from "../../../src/kernel"
import { TransientChannelSimulationPlanSolver } from "../../../src/pipeline"
import { routedVisualIbis } from "../../fixtures/routed-visual-fixture"
import { inverterModelPath } from "../../fixtures/two-trace-plan-input"
import { renderCoreSignals } from "../../support/core-render"

test("records the corrected package model and source hash in the plan manifest", async () => {
  const matrix = `[Define Package Model] Fixture
[Manufacturer] Fixture
[OEM] Fixture
[Description] Positive mutual capacitance magnitudes
[Number Of Pins] 4
[Pin Numbers]
2
3
4
5
[Model Data]
[Inductance Matrix] Full_matrix
[Row] 2
1n 0 0 0
[Row] 3
1n 0 0
[Row] 4
1n 0
[Row] 5
1n
[Capacitance Matrix] Full_matrix
[Row] 2
2p 0 1p 0
[Row] 3
2p 0 0
[Row] 4
2p 0
[Row] 5
2p
[End Model Data]
[End Package Model]
[End]`
  const ibis = routedVisualIbis
    .replace("[Package]", "[Package Model] Fixture\n[Package]")
    .replace("[End]", matrix)
  const solver = new TransientChannelSimulationPlanSolver({
    circuitJson: await renderCoreSignals(<TwoTraceBoard />),
    ibisSources: { [inverterModelPath]: ibis },
  })
  solver.solve()
  const {
    value: [plan],
    artifacts,
  } = solver.getOutput()
  assert.ok(plan.warnings.length > 0)
  for (const warning of plan.warnings) {
    assert.ok(warning.includes(inverterModelPath))
    assert.ok(warning.includes(sha256(ibis)))
    assert.match(warning, /Fixture: negated 2 off-diagonal capacitance entries/)
  }
  const manifest = JSON.parse(artifacts[0].body)
  assert.deepEqual(manifest.channelSimulations[0].warnings, plan.warnings)
  assert.equal(manifest.models[inverterModelPath], sha256(ibis))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { createNativeSolver } from "../../../src/adapters"
import { RoutedPipelineSolver } from "../../../src/pipeline"
import { channelPlanInput } from "../../fixtures/routed-fixture"
import { vendorAvailable } from "../../fixtures/vendor-models"

const CAPTURE_DURATION_SECONDS = 4e-9

test.skipIf(
  Bun.which("ngspice") === null || !vendorAvailable("sn74lvc1g04.ibs"),
)("renders, admits and captures the two-trace board with ngspice", async () => {
  const solver = new RoutedPipelineSolver({
    input: await channelPlanInput({
      props: {
        "bit-rate": "400Mbps",
        "duration-seconds": CAPTURE_DURATION_SECONDS,
        "data-pattern": "1",
      },
    }),
    context: { runSolver: createNativeSolver(), progress: () => undefined },
  })
  await solver.solveAsync()
  assert.equal(solver.MAX_ITERATIONS, Infinity)
  const [{ bindings }] = solver.stageOutput(
    "TransientChannelSimulationPlanSolver",
  ).value
  assert.deepEqual(
    bindings.mappings.map(({ port }) => port),
    ["DATA", "VICTIM"],
  )
  for (const { solverName } of solver.pipelineDef) {
    const stage = solver.getSolver(solverName)
    assert.ok(stage?.solved)
    assert.equal(stage.MAX_ITERATIONS, Infinity)
  }
  const { channelSimulations, files } = solver.getOutput()
  assert.equal(channelSimulations.length, 1)
  const [{ capture, compiled }] = channelSimulations
  assert.equal(capture.kind, "completed")
  assert.ok(capture.timestampsSeconds.length > 2)
  assert.equal(capture.timestampsSeconds.at(-1), CAPTURE_DURATION_SECONDS)
  assert.equal(capture.probes.length, compiled.probes.length)
  assert.ok(Object.keys(files).some((path) => path.endsWith("/capture.json")))
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { formatSpiceVectors } from "../../src/observation"
import { type RoutedDeck, RouteTransientSolver } from "../../src/simulation"
import { routedRequest } from "../../src/simulation/route-transient"
import type { SolverResult } from "../../src/solver"

const compiled: RoutedDeck = {
  blockId: "test",
  name: "test",
  deck: "test",
  requestSha256: "test-request",
  durationSeconds: 1e-9,
  stepSeconds: 1e-11,
  evidence: {},
  probes: [
    {
      name: "VICTIM",
      column: 1,
      simulationVoltageProbeId: "p",
      signalSourceId: "port",
      referenceSourceId: null,
      signalNode: "n1",
      referenceNode: "0",
    },
  ],
}

interface ResponseOptions {
  times?: number[]
  values?: number[]
  stdout?: string
}

/** Synthetic protocol fixture with nonuniform timestamps. */
function response({
  times = [0, 2e-10, 1e-9],
  values = [0, 0.3, 0.1],
  stdout = "",
}: ResponseOptions = {}): SolverResult {
  const raw = formatSpiceVectors([
    { name: "time", type: "time", values: times },
    { name: "v(n1)", type: "voltage", values },
  ])
  return { stdout, stderr: "", files: { "waveform.raw": raw } }
}

/** Inject one synthetic response for parser and lifecycle checks. */
function solver(result: SolverResult): RouteTransientSolver {
  return new RouteTransientSolver({
    compiled,
    artifactPrefix: "test",
    context: { runSolver: async () => result, progress: (): void => undefined },
  })
}

test("one async step invokes once and keeps adaptive times and candidate labels", async () => {
  let calls = 0
  const stage = new RouteTransientSolver({
    compiled,
    artifactPrefix: "test",
    context: {
      runSolver: async (request) => {
        calls++
        assert.deepEqual(request, routedRequest(compiled))
        await new Promise<void>((resolve) => setImmediate(resolve))
        return response()
      },
      progress: (): void => undefined,
    },
  })
  assert.throws(() => stage.step(), /requires stepAsync/)
  assert.throws(() => stage.getOutput(), /incomplete/)
  await stage.stepAsync()
  await stage.stepAsync()
  assert.equal(calls, 1)
  assert.equal(stage.iterations, 1)
  const output = stage.getOutput()
  assert.deepEqual(output.value.timestampsSeconds, [0, 2e-10, 1e-9])
  assert.deepEqual(output.value.probes[0].voltageLevels, [0, 0.3, 0.1])
  assert.equal(output.value.qualification, "candidate-unqualified")
  assert.ok(
    output.artifacts.some(
      (artifact) =>
        artifact.owner === "solver" &&
        artifact.path.endsWith("ngspice.request.json"),
    ),
  )
})

/** Adjust the synthetic waveform while retaining the rest of the response. */
function replaceWaveform(search: string, replacement: string): SolverResult {
  const result = response()
  const raw = result.files["waveform.raw"].replace(search, replacement)
  return { ...result, files: { "waveform.raw": raw } }
}

const truncated = response({ times: [0, 5e-10], values: [0, 1] })
const lateStart = response({ times: [5e-10, 1e-9], values: [0, 1] })
const fatal = response({ stdout: "fatal: rejected" })
for (const [label, result, pattern] of [
  ["truncated", truncated, /simulation_duration: .*did not complete/],
  ["beginning", lateStart, /simulation_start: .*omits the beginning/],
  ["fatal", fatal, /native_solver: .*fatal/],
  [
    "missing vector",
    replaceWaveform("v(n1)", "v(other)"),
    /Missing ngspice vector/,
  ],
  ["nonfinite", replaceWaveform("0.3", "NaN"), /finite/],
] as const) {
  test(`live transient rejects ${label} without exposing partial success`, async () => {
    const stage = solver(result)
    await assert.rejects(stage.solveAsync(), pattern)
    assert.equal(stage.failed, true)
    assert.throws(() => stage.getOutput(), /incomplete/)
  })
}

test("engine rejection is a failed async stage without a capture", async () => {
  const stage = new RouteTransientSolver({
    compiled,
    artifactPrefix: "test",
    context: {
      progress: (): void => undefined,
      runSolver: async () => {
        throw new Error("engine unavailable")
      },
    },
  })
  await assert.rejects(stage.solveAsync(), /unavailable/)
  assert.equal(stage.failed, true)
  assert.throws(() => stage.getOutput(), /incomplete/)
})

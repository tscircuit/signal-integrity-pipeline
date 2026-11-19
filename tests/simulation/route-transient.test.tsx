import { test } from "bun:test"
import assert from "node:assert/strict"
import { formatSpiceVectors } from "../../src/observation"
import { type RoutedDeck, RouteTransientSolver } from "../../src/simulation"
import { routedRequest } from "../../src/simulation/route-transient"
import type { RunSolver, SolverResult } from "../../src/solver"

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
  timesSeconds?: number[]
  values?: number[]
  stdout?: string
}

/** Synthetic protocol fixture with nonuniform timestamps. */
function response({
  timesSeconds = [0, 2e-10, 1e-9],
  values = [0, 0.3, 0.1],
  stdout = "",
}: ResponseOptions = {}): SolverResult {
  const raw = formatSpiceVectors([
    { name: "time", type: "time", values: timesSeconds },
    { name: "v(n1)", type: "voltage", values },
  ])
  return { stdout, stderr: "", files: { "waveform.raw": raw } }
}

/** Inject one synthetic response for parser and lifecycle checks. */
function solver(runSolver: RunSolver): RouteTransientSolver {
  return new RouteTransientSolver({
    compiled,
    artifactPrefix: "test",
    context: { runSolver, progress: (): void => undefined },
  })
}

test("only steps asynchronously", () => {
  const stage = solver(async () => response())
  assert.throws(() => stage.step(), /requires stepAsync/)
})

test("withholds output before solving", () => {
  const stage = solver(async () => response())
  assert.throws(() => stage.getOutput(), /incomplete/)
})

test("invokes the expected request exactly once", async () => {
  let calls = 0
  const stage = solver(async (request) => {
    calls++
    assert.deepEqual(request, routedRequest(compiled))
    await new Promise<void>((resolve) => setImmediate(resolve))
    return response()
  })
  await stage.stepAsync()
  await stage.stepAsync()
  assert.equal(calls, 1)
  assert.equal(stage.iterations, 1)
})

test("preserves adaptive timestamps and voltages", async () => {
  const stage = solver(async () => response())
  await stage.stepAsync()
  const output = stage.getOutput()
  assert.deepEqual(output.value.timestampsSeconds, [0, 2e-10, 1e-9])
  assert.deepEqual(output.value.probes[0].voltageLevels, [0, 0.3, 0.1])
})

test("marks complete captures as candidates", async () => {
  const stage = solver(async () => response())
  await stage.stepAsync()
  assert.equal(stage.getOutput().value.qualification, "candidate-unqualified")
})

test("keeps the solver request artifact", async () => {
  const stage = solver(async () => response())
  await stage.stepAsync()
  assert.ok(
    stage
      .getOutput()
      .artifacts.some(
        (artifact) =>
          artifact.owner === "solver" &&
          artifact.path.endsWith("ngspice.request.json"),
      ),
  )
})

/** Adjust the synthetic waveform while retaining the rest of the response. */
function replaceWaveform({
  search,
  replacement,
}: {
  search: string
  replacement: string
}): SolverResult {
  const result = response()
  const raw = result.files["waveform.raw"].replace(search, replacement)
  return { ...result, files: { "waveform.raw": raw } }
}

/** A rejected run must enter the failure state with no published capture. */
function assertFailed(stage: RouteTransientSolver): void {
  assert.equal(stage.failed, true)
  assert.throws(() => stage.getOutput(), /incomplete/)
}

test("rejects a truncated capture", async () => {
  const stage = solver(async () =>
    response({ timesSeconds: [0, 5e-10], values: [0, 1] }),
  )
  await assert.rejects(
    stage.solveAsync(),
    /simulation_duration: .*did not complete/,
  )
  assertFailed(stage)
})

test("rejects a capture that starts late", async () => {
  const stage = solver(async () =>
    response({ timesSeconds: [5e-10, 1e-9], values: [0, 1] }),
  )
  await assert.rejects(
    stage.solveAsync(),
    /simulation_start: .*omits the beginning/,
  )
  assertFailed(stage)
})

test("rejects a fatal solver diagnostic", async () => {
  const stage = solver(async () => response({ stdout: "fatal: rejected" }))
  await assert.rejects(stage.solveAsync(), /native_solver: .*fatal/)
  assertFailed(stage)
})

test("rejects a missing probe vector", async () => {
  const stage = solver(async () =>
    replaceWaveform({ search: "v(n1)", replacement: "v(other)" }),
  )
  await assert.rejects(stage.solveAsync(), /Missing ngspice vector/)
  assertFailed(stage)
})

test("rejects a nonfinite probe value", async () => {
  const stage = solver(async () =>
    replaceWaveform({ search: "0.3", replacement: "NaN" }),
  )
  await assert.rejects(stage.solveAsync(), /finite/)
  assertFailed(stage)
})

test("withholds capture after an engine failure", async () => {
  const stage = solver(async () => {
    throw new Error("engine unavailable")
  })
  await assert.rejects(stage.solveAsync(), /unavailable/)
  assertFailed(stage)
})

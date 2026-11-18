import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../src/board"
import { sha256 } from "../../src/kernel"
import { formatSpiceVectors } from "../../src/observation"
import {
  RoutedPipelineSolver,
  type RoutedProblem,
  type RoutedStageSolver,
  routedStages,
} from "../../src/pipeline"
import {
  type RouteBindingsInput,
  RouteBindingsSolver,
  type RoutedBindings,
  type RoutedDeck,
  type RouteNetworkInput,
  RouteNetworkSolver,
} from "../../src/simulation"
import type { SolverContext } from "../../src/solver"
import { renderCoreSignals } from "../support/core-render"
import {
  driverWeights,
  transientDuration,
  voltageNames,
} from "../support/routed-deck"
import { routedProblem } from "../support/routed-fixture"
import { routedVisualFixture } from "../support/routed-visual-fixture"

test(
  "TSX two-trace routed deck pins the single coupled skin multiport and declarative transient vectors",
  {
    skip:
      !process.env.IBIS_MODEL_DIR &&
      "Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed",
  },
  async () => {
    const circuit = await renderCoreSignals(
      <TwoTraceBoard bit-rate="400Mbps" duration-seconds={4e-9} />,
    )
    const bytes = await readFile(
      `${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`,
    )
    assert.equal(
      sha256(bytes),
      "03033638d7fe8bf268428be133a5aad63aae0145980113561b20ab92063e2c00",
      "oracle uses the same vendor revision",
    )
    const solver = new RoutedPipelineSolver(
      {
        circuitJson: circuit,
        ibisSources: { "models/sn74lvc1g04.ibs": bytes.toString("utf8") },
        scopeDistanceMm: 1,
      },
      synthetic,
    )
    solver.solveUntilStage("RouteTransientSolver")
    const options = {
      riseSeconds: 1e-9,
      refinement: 1,
      durationSeconds: 4e-9,
      stepSeconds: 1e-11,
    }
    const input = solver
      .getSolver<RoutedStageSolver<RouteBindingsInput, RoutedBindings>>(
        "RouteBindingsSolver",
      )!
      .getConstructorParams()[0][0]
    const bindings = new RouteBindingsSolver({ ...input, options })
    bindings.solve()
    const networkInput = solver
      .getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>(
        "RouteNetworkSolver",
      )!
      .getConstructorParams()[0][0]
    const network = new RouteNetworkSolver({
      ...networkInput,
      bindings: bindings.getOutput().value,
      options,
    })
    network.solve()
    const result = network.getOutput().value
    assert.equal(result.evidence.geometry_wires, 2)
    assert.equal(result.evidence.sections, 1)
    // V8 and JavaScriptCore differ in the final digits of the unchanged BEM coefficients.
    const expected = process.versions.bun
      ? "84d62db005e8b8b39aba038a66d6eb1be137848f4a2b3bdbfccf9d2160f52911"
      : "9373941fc0d7f13fae049b0e6e6571143475eb2356be9468efb5b894e901e63b"
    assert.equal(
      Buffer.byteLength(result.deck),
      process.versions.bun ? 22142 : 22147,
    )
    assert.equal(
      sha256(result.deck),
      expected,
      "full deck bytes, including vendor compilation and coupling, pinned per JS engine",
    )
  },
)

/** Synthetic engine protocol only; native evidence lives in route-transient.test.tsx. */
const synthetic: SolverContext = {
  progress: (): void => undefined,
  runSolver: async (request) => {
    const deck = request.files["simulation.cir"]
    const duration = transientDuration(deck)
    const names = voltageNames(deck)
    return {
      stdout: "",
      stderr: "",
      files: {
        "waveform.raw": formatSpiceVectors([
          { name: "time", type: "time", values: [0, duration] },
          ...names.map((name) => ({
            name: `v(${name})`,
            type: "voltage",
            values: [0, 0],
          })),
        ]),
      },
    }
  },
}

test("six static stages walk all blocks without nested pipelines and produce deterministic artifacts", async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input, synthetic)
  assert.throws(() => solver.getOutput(), /incomplete/)
  await solver.solveAsync()
  assert.deepEqual(solver.pipelineDef, routedStages)
  for (const stage of solver.pipelineDef) {
    const child = solver.getSolver(stage.solverName)!
    assert.equal(child.solved, true)
    assert.equal(
      child instanceof BasePipelineSolver,
      false,
      "domain stages never create nested pipeline rows",
    )
    assert.equal(child.activeSubSolver, undefined)
    assert.ok(Object.keys(child.stats).length > 0)
  }
  const output = solver.getOutput()
  assert.equal(output.blocks[0].capture.kind, "completed")
  assert.ok(
    Object.keys(output.files).some((path) => path.endsWith("/simulation.cir")),
  )
  assert.strictEqual(solver.getOutput(), output)
  const repeat = new RoutedPipelineSolver(
    JSON.parse(JSON.stringify(solver.getConstructorParams()[0])),
    synthetic,
  )
  await repeat.solveAsync()
  assert.deepEqual(repeat.getOutput(), output)
  const renamed = structuredClone(input)
  for (const record of renamed.circuitJson) {
    if (
      record.type === "simulation_pcb_transient_channel_simulation" ||
      record.type === "simulation_pcb_driver_receiver_channel"
    )
      record.simulation_pcb_transient_channel_simulation_id = "getOutput"
  }
  const collision = new RoutedPipelineSolver(renamed, synthetic)
  await collision.solveAsync()
  assert.equal(
    collision.getOutput().blocks[0].id,
    "getOutput",
    "block IDs cannot overwrite debugger methods",
  )
})

test("root with no SI blocks seals only admission and the tuple manifest", () => {
  const solver = new RoutedPipelineSolver(
    { circuitJson: [], ibisSources: {} },
    synthetic,
  )
  solver.solve()
  assert.equal(solver.getOutput().blocks.length, 0)
  assert.deepEqual(
    JSON.parse(solver.getOutput().files["stages.json"]),
    routedStages.map((stage) => stage.solverName),
  )
})

test("default two-trace TSX deck retains the measured driver lead-in and captures its complete rise", async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const solver = new RoutedPipelineSolver(input, synthetic)
  solver.solveUntilStage("RouteTransientSolver")
  assert.equal(
    solver.stageOutput("RoutedAdmissionSolver").value[0].bindings.options
      .durationSeconds,
    40e-9,
  )
  const deck = solver.stageOutput("RouteNetworkSolver").value[0]
  if (!process.versions.bun)
    assert.equal(
      sha256(deck.deck),
      "83867184e5373f0b20e056fe1011de164269396e2b51bb5ff76a171a288371ad",
      "default two-trace deck pins the deliberate single skin multiport realization",
    )
  const values = driverWeights(deck.deck)
  const weights = values
    .filter((_, i) => i % 2 === 0)
    .map((time, i) => [time, values[2 * i + 1]])
  // The old 2.5 ns trigger plus preserved lead-in fell outside its 4 ns capture.
  assert.ok(
    weights.some(
      ([time, ku]) => time > 20e-9 && time < 22e-9 && Math.abs(ku) < 0.01,
    ),
  )
  assert.ok(
    weights.some(([time, ku]) => time > 23e-9 && time < 26e-9 && ku > 0.9),
  )
  assert.ok(weights.at(-1)![1] > 0.9)
})

test("all six static stage definitions exist before the first step", () => {
  const root = new RoutedPipelineSolver(
    { circuitJson: [], ibisSources: {} },
    synthetic,
  )
  const definitions = [...root.pipelineDef]
  assert.equal(definitions.length, 6)
  for (const stage of definitions)
    assert.equal(root.getSolver(stage.solverName), undefined)
  root.step()
  assert.deepEqual(
    root.pipelineDef,
    definitions,
    "admission never creates stage definitions at runtime",
  )
})

test("actual two-block TSX advances every flat stage and invokes transients sequentially", async () => {
  const { root: fixture } = await routedVisualFixture(2)
  let active = 0
  let calls = 0
  const root = new RoutedPipelineSolver(fixture.inputProblem, {
    progress: (): void => undefined,
    runSolver: async (request) => {
      calls++
      assert.equal(++active, 1, "at most one transient can be in flight")
      await new Promise<void>((resolve) => setImmediate(resolve))
      const result = await synthetic.runSolver(request)
      active--
      return result
    },
  })
  root.solveUntilStage("RouteBindingsSolver")
  assert.equal(root.stageOutput("RoutedAdmissionSolver").value.length, 2)
  assert.equal(root.stageOutput("RouteSectionsSolver").value.length, 2)
  assert.equal(root.stageOutput("RouteFieldsSolver").value.length, 2)
  await root.solveAsync()
  assert.equal(calls, 2)
  assert.equal(root.getOutput().blocks.length, 2)
  assert.equal(root.getSolver("RouteTransientSolver")!.stats.invocations, 2)
  for (const stage of root.pipelineDef.slice(1)) {
    const child = root.getSolver(stage.solverName)!
    assert.equal(child.stats.completedBlocks, 2)
    assert.ok(child.iterations >= 2)
    assert.ok(root.timeSpentOnStage[stage.solverName] >= 0)
  }
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../src/board"
import { boardPictureView } from "../../src/board/board-picture"
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
import {
  driverWeights,
  transientDurationSeconds,
  voltageNames,
} from "../fixtures/routed-deck"
import { vendorAvailable } from "../fixtures/vendor-models"
import { renderCoreSignals } from "../support/core-render"
import { routedProblem } from "../support/routed-fixture"

const vendorModelSkip =
  !process.env.IBIS_MODEL_DIR &&
  "Set IBIS_MODEL_DIR to local vendor sn74lvc1g04.ibs; vendor bytes are not committed"

test.skipIf(Boolean(vendorModelSkip))(
  "TSX two-trace deck pins coupled skin loss and transient vectors",
  async () => {
    const circuit = await renderCoreSignals(
      <TwoTraceBoard bit-rate="400Mbps" duration-seconds={4e-9} />,
    )
    const bytes = await readFile(
      `${process.env.IBIS_MODEL_DIR}/sn74lvc1g04.ibs`,
    )
    const modelHash =
      "03033638d7fe8bf268428be133a5aad63aae0145980113561b20ab92063e2c00"
    assert.equal(
      sha256(bytes),
      modelHash,
      "oracle uses the same vendor revision",
    )
    const solver = new RoutedPipelineSolver({
      input: {
        circuitJson: circuit,
        ibisSources: { "models/sn74lvc1g04.ibs": bytes.toString("utf8") },
        scopeDistanceMm: 1,
      },
      context: synthetic,
    })
    solver.solveUntilStage("RouteTransientSolver")
    const options = {
      riseSeconds: 1e-9,
      refinement: 1,
      durationSeconds: 4e-9,
      stepSeconds: 1e-11,
    }
    const bindingsStage = solver.getSolver<
      RoutedStageSolver<RouteBindingsInput, RoutedBindings>
    >("RouteBindingsSolver")!
    const [[input]] = bindingsStage.getConstructorParams()
    const bindings = new RouteBindingsSolver({ ...input, options })
    bindings.solve()
    const networkStage =
      solver.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>(
        "RouteNetworkSolver",
      )!
    const [[networkInput]] = networkStage.getConstructorParams()
    const network = new RouteNetworkSolver({
      ...networkInput,
      bindings: bindings.getOutput().value,
      options,
    })
    network.solve()
    const result = network.getOutput().value
    assert.equal(result.evidence.geometry_wires, 2)
    assert.equal(result.evidence.sections, 1)
    assert.equal(Buffer.byteLength(result.deck), 22146)
    assert.equal(
      sha256(result.deck),
      "e0aed2dc77587fe5e8864ee3c2a1de449951ca096338a81f4541688688ee32b4",
      "pins vendor compilation and coupling",
    )
  },
)

/** Synthetic engine protocol only; native evidence lives in route-transient.test.tsx. */
const synthetic: SolverContext = {
  progress: (): void => undefined,
  runSolver: async (request) => {
    const deck = request.files["simulation.cir"]
    const durationSeconds = transientDurationSeconds(deck)
    const voltageVectors = voltageNames(deck).map((name) => ({
      name: `v(${name})`,
      type: "voltage",
      values: [0, 0],
    }))
    const raw = formatSpiceVectors([
      { name: "time", type: "time", values: [0, durationSeconds] },
      ...voltageVectors,
    ])
    return { stdout: "", stderr: "", files: { "waveform.raw": raw } }
  },
}

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "six flat stages visit every block and produce deterministic artifacts",
  async () => {
    const input = await routedProblem()
    const solver = new RoutedPipelineSolver({ input, context: synthetic })
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
      assert.ok(JSON.stringify(child.visualize()).length > 30)
    }
    const output = solver.getOutput()
    assert.equal(output.blocks[0].capture.kind, "completed")
    assert.ok(
      Object.keys(output.files).some((path) =>
        path.endsWith("/simulation.cir"),
      ),
    )
    assert.strictEqual(solver.getOutput(), output)
    const repeat = new RoutedPipelineSolver({
      input: JSON.parse(JSON.stringify(solver.getConstructorParams()[0].input)),
      context: synthetic,
    })
    await repeat.solveAsync()
    assert.deepEqual(repeat.getOutput(), output)
    assert.ok(solver.visualize().lines!.length > 0)
    const renamed = structuredClone(input)
    for (const record of renamed.circuitJson) {
      if (
        record.type === "simulation_pcb_transient_channel_simulation" ||
        record.type === "simulation_pcb_driver_receiver_channel"
      ) {
        record.simulation_pcb_transient_channel_simulation_id = "getOutput"
      }
    }
    const collision = new RoutedPipelineSolver({
      input: renamed,
      context: synthetic,
    })
    await collision.solveAsync()
    assert.equal(
      collision.getOutput().blocks[0].id,
      "getOutput",
      "block IDs cannot overwrite debugger methods",
    )
  },
)

test("root with no SI blocks seals only admission and the tuple manifest", () => {
  const solver = new RoutedPipelineSolver({
    input: { circuitJson: [], ibisSources: {} },
    context: synthetic,
  })
  solver.solve()
  assert.equal(solver.getOutput().blocks.length, 0)
  assert.deepEqual(
    JSON.parse(solver.getOutput().files["stages.json"]),
    routedStages.map((stage) => stage.solverName),
  )
})

import {
  assertRouteVisual,
  routedVisualFixture,
} from "../fixtures/routed-visual"

test("two-trace TSX root initial and final visual SVG snapshots", async () => {
  const { root } = await routedVisualFixture()
  const initial = new RoutedPipelineSolver({
    input: root.inputProblem,
    context: synthetic,
  })
  assertRouteVisual({
    drawing: initial.initialVisualize(),
    module: "pipeline",
    name: "routed-pipeline-initial",
  })
  assertRouteVisual({
    drawing: root.finalVisualize(),
    module: "pipeline",
    name: "routed-pipeline-final",
  })
})

test("every completed stage retains its own final drawing with few, readable labels", async () => {
  const { root } = await routedVisualFixture()
  const drawing = root.visualize()
  assert.deepEqual(drawing, root.getSolver("RouteTransientSolver")!.visualize())
  for (const definition of root.pipelineDef) {
    const graphics = root.getSolver(definition.solverName)!.visualize()
    const texts = graphics.texts ?? []
    assert.ok(
      texts.length <= 12,
      `${definition.solverName}: no titles, legends or footers`,
    )
    const view = boardPictureView({
      circuit: root.inputProblem.circuitJson,
      drawing: graphics,
    })
    const scale = Math.min(
      1000 / (view.maxX - view.minX),
      540 / (view.maxY - view.minY),
    )
    const readableLabels = texts.every((text) => text.fontSize! * scale >= 10)
    assert.ok(
      readableLabels,
      `${definition.solverName}: all labels are readable at 1080 × 620`,
    )
  }
})

/** A sample from the driver weight waveform. */
type DriverWeight = [timeSeconds: number, weight: number]

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "driver lead-in fits the default capture",
  async () => {
    const input = await routedProblem()
    const solver = new RoutedPipelineSolver({ input, context: synthetic })
    solver.solveUntilStage("RouteTransientSolver")
    assert.equal(
      solver.stageOutput("RoutedAdmissionSolver").value[0].bindings.options
        .durationSeconds,
      40e-9,
    )
    const deck = solver.stageOutput("RouteNetworkSolver").value[0]
    assert.equal(
      sha256(deck.deck),
      "3d8b305c6177e528a127df9503413da57804780e89dbc4ff75544dfe0b56c5fb",
      "default two-trace deck pins the single skin multiport realization",
    )
    const values = driverWeights(deck.deck)
    const weights = values
      .filter((_, i) => i % 2 === 0)
      .map((time, i): DriverWeight => [time, values[2 * i + 1]])
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
  },
)

test("all six static stage definitions exist before the first step", () => {
  const root = new RoutedPipelineSolver({
    input: { circuitJson: [], ibisSources: {} },
    context: synthetic,
  })
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
  const root = new RoutedPipelineSolver({
    input: fixture.inputProblem,
    context: {
      progress: (): void => undefined,
      runSolver: async (request) => {
        calls++
        assert.equal(++active, 1, "at most one transient can be in flight")
        await new Promise<void>((resolve) => setImmediate(resolve))
        const result = await synthetic.runSolver(request)
        active--
        return result
      },
    },
  })
  root.solveUntilStage("RouteBindingsSolver")
  assert.equal(root.stageOutput("RoutedAdmissionSolver").value.length, 2)
  assert.equal(root.stageOutput("RouteSectionsSolver").value.length, 2)
  assert.equal(root.stageOutput("RouteFieldsSolver").value.length, 2)
  const sections = root.getSolver("RouteSectionsSolver")!.visualize()
  assertRouteVisual({
    drawing: root.visualizeStage(3),
    module: "pipeline",
    name: "routed-pipeline-fields",
  })
  assert.ok(
    root.visualize().lines!.length > 0,
    "stage boundaries draw the incoming bindings input",
  )
  await root.solveAsync()
  assert.equal(calls, 2)
  assert.equal(root.getOutput().blocks.length, 2)
  const retainedSections = root.getSolver("RouteSectionsSolver")!.visualize()
  assert.deepEqual(
    retainedSections,
    sections,
    "later stages preserve the final Sections drawing",
  )
  assert.equal(root.getSolver("RouteTransientSolver")!.stats.invocations, 2)
  for (const stage of root.pipelineDef.slice(1)) {
    const child = root.getSolver(stage.solverName)!
    assert.equal(child.stats.completedBlocks, 2)
    assert.ok(child.iterations >= 2)
    assert.ok(root.timeSpentOnStage[stage.solverName] >= 0)
  }
})

/** Every frame must give the board picture a finite, nondegenerate camera, including async waits. */
function assertDrawing({
  circuit,
  frame,
}: {
  circuit: CircuitJson
  frame: {
    drawing: GraphicsObject
    state: string
  }
}): void {
  const { drawing, state } = frame
  const view = boardPictureView({ circuit, drawing })
  assert.ok(
    Object.values(view).every(Number.isFinite),
    `${state}: nonfinite camera ${JSON.stringify(view)}`,
  )
  assert.ok(
    view.maxX > view.minX && view.maxY > view.minY,
    `${state}: degenerate camera`,
  )
}

for (const name of ["two-trace"])
  test(`${name}: every iteration, stage boundary and pending transient has a physical drawing`, async () => {
    const input = (await routedVisualFixture()).root.inputProblem
    const circuit: CircuitJson = input.circuitJson
    let calls = 0
    const solverContext: SolverContext = {
      progress: (): void => undefined,
      runSolver: async (request) => {
        calls++
        const drawing: GraphicsObject = solver.visualize()
        assertDrawing({
          circuit,
          frame: { drawing, state: `${name}: ngspice pending` },
        })
        const curves = drawing.lines!.filter(
          (line) => line.layer === "waveform",
        )
        assert.equal(curves.length, 0, "no curves while ngspice runs")
        await new Promise<void>((resolve) => setImmediate(resolve))
        return synthetic.runSolver(request)
      },
    }
    const solver: RoutedPipelineSolver = new RoutedPipelineSolver({
      input,
      context: solverContext,
    })
    assertDrawing({
      circuit,
      frame: { drawing: solver.visualize(), state: `${name}: initial` },
    })
    while (!solver.solved && !solver.failed) {
      assert.ok(solver.iterations < 200, "bounded iteration check")
      const pending = solver.stepAsync()
      const state = `${name}: iteration ${solver.iterations}`
      assertDrawing({
        circuit,
        frame: { drawing: solver.visualize(), state: `${state} pending` },
      })
      await pending
      assertDrawing({
        circuit,
        frame: {
          drawing: solver.visualize(),
          state: `${name}: iteration ${solver.iterations}`,
        },
      })
      if (solver.getStageOutput("RoutedAdmissionSolver")) {
        assert.ok(
          solver.visualize().lines!.length > 0,
          `${name}: every admitted stage draws selected copper`,
        )
      }
    }
    assert.equal(solver.failed, false)
    assert.equal(calls, 1)
    for (const number of [1, 2, 3, 4, 5, 6]) {
      assertDrawing({
        circuit,
        frame: {
          drawing: solver.visualizeStage(number),
          state: `${name}: retained ${number}`,
        },
      })
    }
  })

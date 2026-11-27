import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { BasePipelineSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import type { CircuitJson } from "../../src/board"
import { boardPictureView } from "../../src/board/board-picture"
import { sha256 } from "../../src/kernel"
import { formatSpiceVectors } from "../../src/observation"
import {
  RoutedPipelineSolver,
  type RoutedStageSolver,
  routedStages,
} from "../../src/pipeline"
import {
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
import { renderTwoTracePlanInput } from "../fixtures/two-trace-plan-input"
import { vendorAvailable } from "../fixtures/vendor-models"
import { renderCoreSignals } from "../support/core-render"

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
        nearbyGapMm: 1,
      },
      context: synthetic,
    })
    solver.solveUntilStage("RouteTransientSolver")
    const options = {
      fastestEdgeSeconds: 1e-9,
      refinement: 1,
    }
    const networkStage =
      solver.getSolver<RoutedStageSolver<RouteNetworkInput, RoutedDeck>>(
        "RouteNetworkSolver",
      )!
    const [[networkInput]] = networkStage.getConstructorParams()
    const network = new RouteNetworkSolver({
      ...networkInput,
      channelNetlist: {
        ...networkInput.channelNetlist,
        plan: {
          ...networkInput.channelNetlist.plan,
          durationSeconds: 4e-9,
          maxStepSeconds: 1e-11,
        },
      },
      options,
    })
    network.solve()
    const result = network.getOutput().value
    assert.equal(result.evidence.geometry_wires, 2)
    assert.equal(result.evidence.sections, 1)
    assert.equal(Buffer.byteLength(result.deck), 22146)
    assert.equal(
      sha256(withPinnedPackageText(result.deck)),
      "e0aed2dc77587fe5e8864ee3c2a1de449951ca096338a81f4541688688ee32b4",
      "pins vendor compilation and coupling",
    )
  },
)

/** Express the two-trace package stamps in the original deck oracle's order and spelling. */
function withPinnedPackageText(deck: string): string {
  const seriesNames = [
    "RPKG1",
    "LPKG1",
    "VDIE1",
    "VPKG1",
    "RPKG2",
    "LPKG2",
    "VDIE2",
    "VPKG2",
  ]
  const capacitanceNames = ["CPKG0a", "CPKG0b", "CPKG1a", "CPKG1b"]
  const packageNames = [...seriesNames, ...capacitanceNames]
  const lines = deck.split("\n")
  let packageCount = 0
  const pinned: string[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith("RPKG1 ")) {
      pinned.push(lines[index])
      continue
    }
    const elements = lines.slice(index, index + packageNames.length)
    assert.deepEqual(
      elements.map((element) => element.split(" ", 1)[0]),
      packageNames,
    )
    const [r1, l1, die1, probe1, r2, l2, die2, probe2, c0a, c0b, c1a, c1b] =
      elements
    packageCount++
    pinned.push(
      c0a,
      c0b,
      r1,
      l1,
      die1.replace("VDIE1 ", "VPDN1 "),
      probe1,
      c1a,
      c1b,
      r2,
      l2,
      die2.replace("VDIE2 ", "VPDN2 "),
      probe2,
    )
    index += packageNames.length - 1
  }
  assert.equal(packageCount, 4)
  assert.equal(deck.split(".vdie1)").length, packageCount + 1)
  assert.equal(deck.split(".vdie2)").length, packageCount + 1)
  return pinned
    .join("\n")
    .replaceAll(".vdie1)", ".vpdn1)")
    .replaceAll(".vdie2)", ".vpdn2)")
}

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
  "six flat stages visit every channelSimulation and produce deterministic artifacts",
  async () => {
    const input = await renderTwoTracePlanInput()
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
    assert.equal(output.channelSimulations[0].capture.kind, "completed")
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
    const renamed = {
      ...input,
      circuitJson: structuredClone(input.circuitJson),
    }
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
      collision.getOutput().channelSimulations[0].id,
      "getOutput",
      "channelSimulation IDs cannot overwrite debugger methods",
    )
  },
)

test("root with no channel simulations seals only the plan and the tuple manifest", () => {
  const solver = new RoutedPipelineSolver({
    input: { circuitJson: [], ibisSources: {} },
    context: synthetic,
  })
  solver.solve()
  assert.equal(solver.getOutput().channelSimulations.length, 0)
  assert.deepEqual(
    JSON.parse(solver.getOutput().files["stages.json"]),
    routedStages.map((stage) => stage.solverName),
  )
})

import {
  assertPlanDrawingSnapshot,
  routedVisualFixture,
} from "../fixtures/routed-visual"

test("two-trace TSX root initial and final visual SVG snapshots", async () => {
  const { root } = await routedVisualFixture()
  const initial = new RoutedPipelineSolver({
    input: root.inputProblem,
    context: synthetic,
  })
  assertPlanDrawingSnapshot({
    drawing: initial.initialVisualize(),
    module: "pipeline",
    name: "routed-pipeline-initial",
  })
  assertPlanDrawingSnapshot({
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
    const planner =
      definition.solverName === "TransientChannelSimulationPlanSolver"
    if (planner) {
      assert.ok(texts.some((text) => text.text.endsWith(": plan ready")))
      assert.ok(texts.every((text) => text.anchorSide === "center"))
    } else {
      assert.ok(
        texts.length <= 12,
        `${definition.solverName}: no titles, legends or footers`,
      )
    }
    const view = boardPictureView({
      circuit: root.inputProblem.circuitJson,
      drawing: graphics,
    })
    const [width, height] = planner ? [1100, 800] : [1000, 540]
    const scale = Math.min(
      width / (view.maxX - view.minX),
      height / (view.maxY - view.minY),
    )
    const readableLabels = texts.every(
      (text) =>
        typeof text.fontSize === "number" && text.fontSize * scale >= 10,
    )
    assert.ok(
      readableLabels,
      `${definition.solverName}: all labels are readable in the stage view`,
    )
  }
})

/** A sample from the driver weight waveform. */
type DriverWeight = [timeSeconds: number, weight: number]

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "driver lead-in fits the default capture",
  async () => {
    const input = await renderTwoTracePlanInput()
    const solver = new RoutedPipelineSolver({ input, context: synthetic })
    solver.solveUntilStage("RouteTransientSolver")
    assert.equal(
      solver.stageOutput("ChannelNetlistSolver").value[0].plan.durationSeconds,
      40e-9,
    )
    const deck = solver.stageOutput("RouteNetworkSolver").value[0]
    assert.equal(
      sha256(withPinnedPackageText(deck.deck)),
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
    "channel planning never creates stage definitions at runtime",
  )
})

test("actual two-channel simulation TSX advances every flat stage and invokes transients sequentially", async () => {
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
  root.solveUntilStage("ChannelNetlistSolver")
  assert.equal(
    root.stageOutput("TransientChannelSimulationPlanSolver").value.length,
    2,
  )
  assert.equal(
    root.stageOutput("CopperGeometryExtractionSolver").value.length,
    2,
  )
  assert.equal(root.stageOutput("TransmissionLineRlgcSolver").value.length, 2)
  const sections = root.getSolver("CopperGeometryExtractionSolver")!.visualize()
  assertPlanDrawingSnapshot({
    drawing: root.visualizeStage(3),
    module: "pipeline",
    name: "routed-pipeline-rlgc",
  })
  assert.ok(
    root.visualize().lines!.length > 0,
    "stage boundaries draw the incoming channel netlist",
  )
  await root.solveAsync()
  assert.equal(calls, 2)
  assert.equal(root.getOutput().channelSimulations.length, 2)
  const retainedSections = root
    .getSolver("CopperGeometryExtractionSolver")!
    .visualize()
  assert.deepEqual(
    retainedSections,
    sections,
    "later stages preserve the final Sections drawing",
  )
  assert.equal(root.getSolver("RouteTransientSolver")!.stats.invocations, 2)
  for (const stage of root.pipelineDef.slice(1)) {
    const child = root.getSolver(stage.solverName)!
    assert.equal(child.stats.completedChannelSimulations, 2)
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
    const circuit = input.circuitJson
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
      if (solver.getStageOutput("TransientChannelSimulationPlanSolver")) {
        assert.ok(
          solver.visualize().lines!.length > 0,
          `${name}: every subsequent stage draws selected copper`,
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

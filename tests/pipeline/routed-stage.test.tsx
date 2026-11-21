import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  type RoutedSections,
  type RouteSectionsInput,
  RouteSectionsSolver,
} from "../../src/board"
import { RoutedStageSolver } from "../../src/pipeline"
import { type RoutedCapture, RouteTransientSolver } from "../../src/simulation"
import { routedVisualFixture } from "../fixtures/routed-visual"

test("a flat stage drains real TSX block inputs in order and retains the last drawing", async () => {
  const { root } = await routedVisualFixture(2)
  const sections = root.getSolver<
    RoutedStageSolver<RouteSectionsInput, RoutedSections>
  >("RouteSectionsSolver")!
  const [inputs] = sections.getConstructorParams()
  const stage = new RoutedStageSolver({
    inputs: [...inputs].reverse(),
    solverClass: RouteSectionsSolver,
  })
  stage.step()
  assert.equal(
    stage.stats.completedBlocks,
    0,
    "one step cannot consume an entire multi-route block",
  )
  assert.throws(() => stage.getOutput(), /incomplete/)
  stage.solve()
  assert.deepEqual(
    stage.getOutput().value,
    [...root.stageOutput("RouteSectionsSolver").value].reverse(),
  )
  assert.equal(stage.getOutput().artifacts.length, 4)
  assert.equal(stage.stats.completedBlocks, 2)
  assert.equal(stage.progress, 1)
  const last = new RouteSectionsSolver(inputs[0])
  last.solve()
  assert.deepEqual(stage.visualize(), last.visualize())
  assert.equal(stage.activeSubSolver, undefined)
})

test("an empty transient stage completes synchronously without invoking the runtime", () => {
  const stage = new RoutedStageSolver({
    inputs: [],
    solverClass: RouteTransientSolver,
  })
  stage.solve()
  assert.deepEqual(stage.getOutput(), { value: [], artifacts: [] })
  assert.equal(stage.progress, 1)
})

test("a failing block stops the flat stage before later blocks or partial outputs", async () => {
  const { root } = await routedVisualFixture(2)
  type Input = ReturnType<RouteTransientSolver["getConstructorParams"]>[0]
  const transient = root.getSolver<RoutedStageSolver<Input, RoutedCapture>>(
    "RouteTransientSolver",
  )!
  const [inputs] = transient.getConstructorParams()
  let calls = 0
  const stage = new RoutedStageSolver({
    inputs: inputs.map((input) => ({
      ...input,
      context: {
        progress: (): void => undefined,
        runSolver: async () => {
          calls++
          throw new Error("bounded engine failure")
        },
      },
    })),
    solverClass: RouteTransientSolver,
  })
  await assert.rejects(stage.solveAsync(), /bounded engine failure/)
  assert.equal(calls, 1)
  assert.equal(stage.failed, true)
  assert.match(stage.error!, /bounded engine failure/)
  assert.equal(stage.stats.completedBlocks, 0)
  assert.throws(() => stage.getOutput(), /incomplete/)
})

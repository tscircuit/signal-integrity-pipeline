import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  type RouteSectionsInput,
  RouteSectionsSolver,
  segmentRoutes,
} from "../../src/board"
import { routedCopper } from "../fixtures/routed-copper"

/** Select the shared two-route TSX fixture and its ground reference. */
async function sectionInput(): Promise<RouteSectionsInput> {
  const { circuitJson, scope } = await routedCopper()
  return {
    circuitJson,
    scope,
    requiredSourcePortIds: [],
    artifactPrefix: "test",
  }
}

test("sections process one route per step", async () => {
  const input = await sectionInput()
  const { circuitJson, scope } = input
  const solver = new RouteSectionsSolver(input)
  solver.step()
  assert.equal(solver.solved, false)
  assert.equal(solver.stats.routes, 1)
  solver.solve()
  assert.deepEqual(
    solver.getOutput().value.geometry,
    segmentRoutes({ circuit: circuitJson, scope }),
  )
  assert.ok(solver.visualize().lines!.length)
})

test("sections reject missing physical contacts", async () => {
  const input = await sectionInput()
  const invalid = new RouteSectionsSolver({
    ...input,
    requiredSourcePortIds: ["missing-port"],
  })
  assert.throws(() => invalid.solve(), /no physical wire or via contact/)
  assert.equal(invalid.failed, true)
  assert.throws(() => invalid.getOutput(), /incomplete/)
})

import {
  assertRouteVisual,
  routedVisualFixture,
} from "../fixtures/routed-visual"

test("two-trace TSX route-sections-solver visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual({
    drawing: root
      .getSolver<RouteSectionsSolver>("RouteSectionsSolver")!
      .visualize(),
    module: "board",
    name: "route-sections-solver",
  })
})

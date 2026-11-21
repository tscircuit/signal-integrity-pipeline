import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../src/board"
import {
  RoutedAdmissionSolver,
  type RoutedStageSolver,
} from "../../src/pipeline"
import {
  type RouteBindingsInput,
  RouteBindingsSolver,
  type RoutedBindings,
} from "../../src/simulation"
import { vendorAvailable } from "../fixtures/vendor-models"
import { routedProblem } from "../support/routed-fixture"

/** Prepare routed bindings from the standalone TSX fixture. */
async function routeBindings(): Promise<RouteBindingsSolver> {
  const input = await routedProblem()
  const admission = new RoutedAdmissionSolver(input)
  admission.solve()
  const plan = admission.getOutput().value[0]
  const sections = new RouteSectionsSolver(plan.sections)
  sections.solve()
  return new RouteBindingsSolver({
    ...plan.bindings,
    scope: sections.getOutput().value.scope,
  })
}

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "compiles one buffer per step",
  async () => {
    const solver = await routeBindings()
    solver.step()
    assert.equal(solver.stats.models, 1)
    assert.equal(solver.solved, false)
    solver.solve()
    const output = solver.getOutput()
    assert.equal(output.value.models.length, 4)
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "allocates nodes for all compiled pins",
  async () => {
    const solver = await routeBindings()
    solver.solve()
    const { models, nodeMap } = solver.getOutput().value
    const ports = models.flatMap((model) =>
      Object.values(model.spicePinMapping),
    )
    assert.ok(ports.every((port) => nodeMap[port] !== undefined))
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "freezes the allocated node map",
  async () => {
    const solver = await routeBindings()
    solver.solve()
    assert.ok(Object.isFrozen(solver.getOutput().value.nodeMap))
    const glyphs = solver
      .visualize()
      .polygons!.filter((polygon) => polygon.points.length === 3)
    assert.equal(
      glyphs.length,
      8,
      "a glyph at each lane end on the board and in the strip",
    )
    assert.equal(
      glyphs.filter((glyph) => glyph.fill !== routeTones.halo).length,
      4,
      "drivers are filled",
    )
  },
)

import { routeTones } from "../../src/board"
import {
  assertRouteVisual,
  routedVisualFixture,
} from "../fixtures/routed-visual"

test("two-trace TSX route-bindings visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual({
    drawing: root
      .getSolver<RouteBindingsSolver>("RouteBindingsSolver")!
      .visualize(),
    module: "simulation",
    name: "route-bindings",
  })
})

test("missing IBIS bytes mark physical endpoints and rejection reason red", async () => {
  const { root } = await routedVisualFixture()
  const stage = root.getSolver<
    RoutedStageSolver<RouteBindingsInput, RoutedBindings>
  >("RouteBindingsSolver")!
  const [[params]] = stage.getConstructorParams()
  const missing = new RouteBindingsSolver({ ...params, ibisSources: {} })
  assert.throws(() => missing.solve())
  const drawing = missing.visualize()
  assert.ok(
    drawing.polygons!.some((outline) => outline.stroke === routeTones.failure),
    "unbound parts are outlined red",
  )
  assert.ok(
    drawing.texts!.some(
      (text) =>
        text.color === routeTones.failure && text.text.includes("model"),
    ),
  )
  assertRouteVisual({
    drawing,
    module: "simulation",
    name: "route-bindings-missing",
  })
})

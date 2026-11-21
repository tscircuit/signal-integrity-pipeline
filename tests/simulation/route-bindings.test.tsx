import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../src/board"
import { RoutedAdmissionSolver } from "../../src/pipeline"
import { RouteBindingsSolver } from "../../src/simulation"
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
  },
)

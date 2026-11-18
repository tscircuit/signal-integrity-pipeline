import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../src/board"
import { RouteFieldsSolver } from "../../src/extraction"
import { RoutedAdmissionSolver } from "../../src/pipeline"
import { RouteBindingsSolver, RouteNetworkSolver } from "../../src/simulation"
import { routedProblem } from "../support/routed-fixture"
import { vendorAvailable } from "../support/vendor-models"

test("network owns real ladder node samples, complete probe evidence and the executable deck", async (context) => {
  const input = await routedProblem(context)
  if (!input) return

  const admission = new RoutedAdmissionSolver(input)
  admission.solve()
  const plan = admission.getOutput().value[0]
  const sections = new RouteSectionsSolver(plan.sections)
  sections.solve()
  const { geometry, circuitJson, scope, maskThicknessMm } =
    sections.getOutput().value
  const fields = new RouteFieldsSolver({
    geometry,
    circuitJson,
    scope,
    maskThicknessMm,
    materials: plan.bindings.options.materials,
    artifactPrefix: plan.sections.artifactPrefix,
  })
  fields.solve()
  const extracted = fields.getOutput().value
  const bindings = new RouteBindingsSolver({ ...plan.bindings, scope })
  bindings.solve()
  const network = new RouteNetworkSolver({
    blockId: plan.id,
    name: plan.name,
    geometry,
    extracted,
    bindings: bindings.getOutput().value,
    materials: extracted.materials,
    options: plan.bindings.options,
    warnings: plan.warnings,
    artifactPrefix: plan.sections.artifactPrefix,
  })
  network.solve()
  const output = network.getOutput().value
  assert.ok(network.iterations >= 3)
  assert.ok(output.evidence.cells)
  assert.ok(output.evidence.maximum_cell_delay_s)
  assert.ok(output.deck.includes("RBIAS"))
  // klu_refactor reuses the first transient pivots; the zero-diagonal skin multiport rows need KLU tol 0.1.
  assert.match(output.deck, /^\.options klu .* pivrel=0\.1$/m)
  assert.equal(
    output.probes.length,
    3,
    "two receivers and the existing rail monitor",
  )
  assert.ok(
    (output.evidence.warnings as string[]).some((warning) =>
      warning.includes("candidate channel experiment"),
    ),
  )
})

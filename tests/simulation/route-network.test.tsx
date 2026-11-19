import { test } from "bun:test"
import assert from "node:assert/strict"
import { RouteSectionsSolver } from "../../src/board"
import { RouteFieldsSolver } from "../../src/extraction"
import { RoutedAdmissionSolver } from "../../src/pipeline"
import { RouteBindingsSolver, RouteNetworkSolver } from "../../src/simulation"
import { routedProblem } from "../support/routed-fixture"
import { vendorAvailable } from "../support/vendor-models"

let testNetwork: RouteNetworkSolver | undefined

/** Assemble the network from the rendered fixture and the local vendor model. */
async function routedNetwork(): Promise<RouteNetworkSolver> {
  if (testNetwork) return testNetwork
  const input = await routedProblem()
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
  testNetwork = network
  return network
}

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "steps through ladder runs",
  async () => {
    const network = await routedNetwork()
    assert.ok(network.iterations >= 3)
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "records ladder statistics",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value
    assert.ok(output.evidence.cells)
    assert.ok(output.evidence.maximum_cell_delay_s)
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "anchors floating copper",
  async () => {
    const network = await routedNetwork()
    assert.ok(network.getOutput().value.deck.includes("RBIAS"))
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "sets the KLU pivot tolerance",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value
    // klu_refactor reuses the first transient pivots; the zero-diagonal skin multiport rows need KLU tol 0.1.
    assert.match(output.deck, /^\.options klu .* pivrel=0\.1$/m)
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "keeps all planned probes",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value
    assert.equal(
      output.probes.length,
      3,
      "two receivers and the existing rail monitor",
    )
  },
)

test.skipIf(!vendorAvailable("sn74lvc1g04.ibs"))(
  "records the scope of candidate evidence",
  async () => {
    const network = await routedNetwork()
    const output = network.getOutput().value
    assert.ok(
      (output.evidence.warnings as string[]).some((warning) =>
        warning.includes("candidate channel experiment"),
      ),
    )
  },
)

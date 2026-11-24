import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedPipelineSolver } from "../../../src/pipeline"
import { routedVisualFixture } from "../../fixtures/routed-visual"

test("carries explicit dielectric materials from planning to the RLGC artifact", async () => {
  const { root: fixture } = await routedVisualFixture()
  const materials = {
    maskThicknessMm: 0,
    maskRelativePermittivity: 3.1,
    maskLossTangent: 0.02,
    laminateLossTangent: 0.015,
  }
  const expected = { ...materials }
  const root = new RoutedPipelineSolver({
    input: { ...fixture.inputProblem, materials },
    context: {
      runSolver: async (): Promise<never> => {
        throw new Error("This fixture stops after the RLGC stage")
      },
    },
  })
  materials.maskThicknessMm = 0.03
  root.solveUntilStage("RouteBindingsSolver")
  const [plan] = root.stageOutput("TransientChannelSimulationPlanSolver").value
  assert.deepEqual(plan.bindings.options.materials, expected)
  const {
    value: [result],
    artifacts: [artifact],
  } = root.stageOutput("TransmissionLineRlgcSolver")
  assert.deepEqual(result.materials, expected)
  assert.equal(result.maskThicknessSource, "explicit")
  assert.equal(artifact.owner, "rlgc")
  assert(artifact.path.endsWith("/transmission-line-rlgc.json"))
})

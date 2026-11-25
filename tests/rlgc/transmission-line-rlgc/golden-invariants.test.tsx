import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { renderRoutedCopper } from "../../fixtures/routed-copper"
import { routedVisualFixture } from "../../fixtures/routed-visual"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"
import {
  energyFacts,
  hasNonnegativeLoss,
  isGroundedMaxwell,
  isPositiveDefinite,
  maxwellFacts,
} from "../../support/golden-checks"

test("golden invariants: every routed TSX section has SPD L/C with |k| < 1, Maxwell C and PSD R/G", async () => {
  // Passive reciprocal multiconductor lines (Paul, Analysis of Multiconductor Transmission Lines, 2nd ed.,
  // sections 3.2–3.4): L and C symmetric positive definite, every pairwise |k| < 1; grounded Maxwell C has a
  // positive diagonal, non-positive off-diagonal entries (zero only across shielding planes) and non-negative row
  // sums. R(f) = R_dc + congruence(sqrt(f) R_skin) and G(f) = 2 pi f D are PSD iff R_dc, R_skin and D are PSD.
  // Tolerances are floating point only: asymmetry 1e-12, row sums >= -1e-9 C_ii, PSD eigenvalues >= -1e-12 of
  // the largest.
  const { circuitJson, copperScope: scope } = await renderRoutedCopper()
  const copper = new TransmissionLineRlgcSolver({
    copperGeometry: solveBoardCopperGeometry({
      circuitJson,
      copperScope: scope,
    }),
    artifactPrefix: "golden",
  })
  copper.solve()
  const { root } = await routedVisualFixture()
  const copperSolutions = copper.getOutput().value.crossSectionSolutions
  const sections = [
    ...copperSolutions.map((section) => ({
      board: "routedCopper",
      ...section,
    })),
    ...root
      .stageOutput("TransmissionLineRlgcSolver")
      .value.flatMap((extracted) =>
        extracted.crossSectionSolutions.map((section) => ({
          board: "TwoTraceBoard",
          ...section,
        })),
      ),
  ]
  const rows: Record<string, number | string>[] = []
  const failures: string[] = []
  for (const { board, crossSectionKey, rlgcMatrices } of sections) {
    const label = `${board} ${crossSectionKey.slice(0, 40)}`
    let coupling = 0
    let minimum = Infinity
    for (const [name, matrix] of [
      ["L", rlgcMatrices.externalInductanceHenriesPerMeter],
      ["C", rlgcMatrices.capacitanceFaradsPerMeter],
      ["C0", rlgcMatrices.vacuumCapacitanceFaradsPerMeter],
    ] as const) {
      const facts = energyFacts(matrix.map((row) => [...row]))
      coupling = Math.max(coupling, facts.coupling)
      minimum = Math.min(
        minimum,
        facts.minimumEigenvalue / facts.maximumEigenvalue,
      )
      if (!isPositiveDefinite(facts))
        failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    const maxwell = maxwellFacts(
      rlgcMatrices.capacitanceFaradsPerMeter.map((row) => [...row]),
    )
    if (!isGroundedMaxwell({ facts: maxwell }))
      failures.push(`${label} Maxwell: ${JSON.stringify(maxwell)}`)
    const lossMatrices = [
      ["R_dc", rlgcMatrices.dcResistanceOhmsPerMeter],
      ["R_skin", rlgcMatrices.totalSkinResistanceOhmsPerMeterPerSqrtHz],
      ["D", rlgcMatrices.dielectricLossFaradsPerMeter],
    ] as const
    for (const [name, matrix] of lossMatrices) {
      const facts = energyFacts(matrix.map((row) => [...row]))
      if (!hasNonnegativeLoss({ matrix, facts }))
        failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    rows.push({
      section: label,
      conductors: rlgcMatrices.externalInductanceHenriesPerMeter.length,
      smallestEigenvalueRatio: +minimum.toExponential(3),
      largestCouplingK: +coupling.toFixed(4),
    })
  }
  console.table(rows)
  assert.ok(sections.length >= 2, "both routed boards produced sections")
  assert.deepEqual(failures, [])
})

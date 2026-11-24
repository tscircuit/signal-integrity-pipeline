import { test } from "bun:test"
import assert from "node:assert/strict"
import { type CrossSection, calculateRlgc } from "../../../src/rlgc"
import { crossSectionFixture } from "../../fixtures/cross-section"
import { centred } from "../../fixtures/rlgc-golden"
import {
  energyFacts,
  hasNonnegativeLoss,
  isGroundedMaxwell,
  isPositiveDefinite,
  maxwellFacts,
} from "../../support/golden-checks"

test("golden invariants: extracted L, C0, C are SPD with |k| < 1, C is Maxwell, R(f) and G(f) are PSD", () => {
  // Passive reciprocal multiconductor lines (Paul, MTL 2nd ed., sections 3.2–3.4): L, C symmetric positive
  // definite, every pairwise |k| < 1; grounded Maxwell C has positive diagonal, negative off-diagonal entries and
  // non-negative row sums (capacitance to the references). Loss matrices R(f), G(f) are PSD. Tolerances are
  // floating point only: asymmetry 1e-12, row sums >= -1e-9 C_ii, PSD eigenvalues >= -1e-12 of the largest.
  const sections: {
    label: string
    section: CrossSection
  }[] = [
    ...(["microstrip", "stripline", "mask"] as const).flatMap((kind) =>
      [1, 2, 12].map((count) => ({
        label: `${kind} ${count}`,
        section: crossSectionFixture({ kind, count }),
      })),
    ),
    {
      label: "centred stripline w/b 1",
      section: centred({ w: 1, b: 1, t: 0.035, er: 4 }),
    },
  ]
  const rows: Record<string, number | string>[] = []
  const failures: string[] = []
  for (const { label, section } of sections) {
    const line = calculateRlgc({ crossSection: section })
    let minimum = Infinity
    let coupling = 0
    for (const [name, matrix] of [
      [
        "externalInductanceHenriesPerMeter",
        line.externalInductanceHenriesPerMeter,
      ],
      ["vacuumCapacitanceFaradsPerMeter", line.vacuumCapacitanceFaradsPerMeter],
      ["capacitanceFaradsPerMeter", line.capacitanceFaradsPerMeter],
    ] as const) {
      const facts = energyFacts(matrix)
      minimum = Math.min(
        minimum,
        facts.minimumEigenvalue / facts.maximumEigenvalue,
      )
      coupling = Math.max(coupling, facts.coupling)
      if (!isPositiveDefinite(facts))
        failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    for (const name of [
      "capacitanceFaradsPerMeter",
      "vacuumCapacitanceFaradsPerMeter",
    ] as const) {
      const facts = maxwellFacts(line[name])
      let offDiagonalLimit = 1
      if (section.conductors.length > 1) offDiagonalLimit = 0
      if (
        !isGroundedMaxwell({ facts, strictOffDiagonalLimit: offDiagonalLimit })
      ) {
        failures.push(`${label} ${name} Maxwell: ${JSON.stringify(facts)}`)
      }
    }
    // The ladder scales each loss matrix by a nonnegative network response (check 12), so PSD matrices give PSD
    // R(f), G(f).
    for (const name of [
      "dcResistanceOhmsPerMeter",
      "totalSkinResistanceOhmsPerMeterPerSqrtHz",
      "conductorSkinResistanceOhmsPerMeterPerSqrtHz",
      "dielectricLossFaradsPerMeter",
    ] as const) {
      const facts = energyFacts(line[name])
      if (hasNonnegativeLoss({ matrix: line[name], facts })) continue
      failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    rows.push({
      section: label,
      smallestEigenvalueRatio: +minimum.toExponential(3),
      largestCouplingK: +coupling.toFixed(4),
    })
  }
  console.table(rows)
  assert.deepEqual(failures, [])
}, 30_000)

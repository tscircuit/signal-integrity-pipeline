import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import { projectAcGroundedSeries } from "../../../src/simulation/ac-grounded-series"
import { renderTransmissionLineRlgcInput } from "../../fixtures/transmission-line-rlgc"

test("validates grounded-conductor indices before projecting series matrices", async () => {
  const solver = new TransmissionLineRlgcSolver(
    await renderTransmissionLineRlgcInput(),
  )
  solver.solve()
  const { rlgcMatrices } = solver.getOutput().value.solvedWireSections[0]
  assert.equal(rlgcMatrices.externalInductanceHenriesPerMeter.length, 2)
  for (const grounded of [[-1], [2], [0.5], [1, 1]]) {
    assert.throws(
      () =>
        projectAcGroundedSeries({
          rlgcMatrices,
          groundedConductorIndices: grounded,
        }),
      /Grounded conductor indices/,
    )
  }
  const series = projectAcGroundedSeries({
    rlgcMatrices,
    groundedConductorIndices: [1],
  })
  const expected =
    rlgcMatrices.externalInductanceHenriesPerMeter[0][0] -
    rlgcMatrices.externalInductanceHenriesPerMeter[0][1] ** 2 /
      rlgcMatrices.externalInductanceHenriesPerMeter[1][1]
  assert(
    Math.abs(series.externalInductanceHenriesPerMeter[0][0] / expected - 1) <
      1e-12,
  )
  const conductorCurrentRatio =
    -rlgcMatrices.externalInductanceHenriesPerMeter[0][1] /
    rlgcMatrices.externalInductanceHenriesPerMeter[1][1]
  const resistance = rlgcMatrices.conductorSkinResistanceOhmsPerMeterPerSqrtHz
  const expectedSkin =
    resistance[0][0] +
    2 * conductorCurrentRatio * resistance[0][1] +
    conductorCurrentRatio ** 2 * resistance[1][1]
  assert(
    Math.abs(
      series.conductorSkinResistanceOhmsPerMeterPerSqrtHz[0][0] / expectedSkin -
        1,
    ) < 1e-12,
  )
  assert(Object.isFrozen(series.externalInductanceHenriesPerMeter))
  assert.deepEqual(
    Object.keys(
      projectAcGroundedSeries({ rlgcMatrices, groundedConductorIndices: [] }),
    ),
    Object.keys(series),
  )
})

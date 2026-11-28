import { multiply, transpose } from "../extraction"
import { type Matrix, type Snapshot, snapshot, symmetrize } from "../kernel"
import { calculateMatrixInverse, type RlgcMatrices } from "../rlgc"

/** Inductance and skin resistance in the original conductor indexing after projection. */
type AcGroundedSeriesMatrices = Snapshot<
  Pick<
    RlgcMatrices,
    | "externalInductanceHenriesPerMeter"
    | "totalSkinResistanceOhmsPerMeterPerSqrtHz"
    | "conductorSkinResistanceOhmsPerMeterPerSqrtHz"
  >
>

/** Apply the same current projection to both axes and remove rounding asymmetry. */
function projectMatrix({
  matrix,
  conductorCurrents,
  transposedCurrents,
}: {
  matrix: Snapshot<Matrix>
  conductorCurrents: Matrix
  transposedCurrents: Matrix
}): Matrix {
  return symmetrize(
    multiply({
      a: transposedCurrents,
      b: multiply({ a: matrix, b: conductorCurrents }),
    }),
  )
}

/** Enforce zero inductive voltage on grounded rails and use those currents for skin loss. */
export function projectAcGroundedSeries({
  rlgcMatrices,
  groundedConductorIndices,
}: {
  rlgcMatrices: Snapshot<RlgcMatrices>
  groundedConductorIndices: readonly number[]
}): AcGroundedSeriesMatrices {
  const {
    externalInductanceHenriesPerMeter,
    totalSkinResistanceOhmsPerMeterPerSqrtHz,
    conductorSkinResistanceOhmsPerMeterPerSqrtHz,
  } = rlgcMatrices
  const seriesMatrices = {
    externalInductanceHenriesPerMeter,
    totalSkinResistanceOhmsPerMeterPerSqrtHz,
    conductorSkinResistanceOhmsPerMeterPerSqrtHz,
  }
  const conductorCount = rlgcMatrices.conductorIds.length
  const grounded = new Set(groundedConductorIndices)
  if (
    grounded.size !== groundedConductorIndices.length ||
    groundedConductorIndices.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= conductorCount,
    )
  )
    throw new Error(
      "Grounded conductor indices must be unique integers in the matrix",
    )
  if (grounded.size === 0) return snapshot(seriesMatrices)

  const inductance = externalInductanceHenriesPerMeter
  const inverse = calculateMatrixInverse(
    groundedConductorIndices.map((row) =>
      groundedConductorIndices.map((column) => inductance[row][column]),
    ),
  )
  const conductorCurrents = inductance.map((row, rowIndex) =>
    row.map((_, columnIndex) =>
      Number(rowIndex === columnIndex && !grounded.has(rowIndex)),
    ),
  )
  for (const [rowIndex, row] of groundedConductorIndices.entries()) {
    for (let column = 0; column < conductorCount; column++) {
      if (grounded.has(column)) continue
      conductorCurrents[row][column] = -groundedConductorIndices.reduce(
        (sum, index, columnIndex) =>
          sum + inverse[rowIndex][columnIndex] * inductance[index][column],
        0,
      )
    }
  }
  const transposedCurrents = transpose(conductorCurrents)
  return snapshot({
    externalInductanceHenriesPerMeter: projectMatrix({
      matrix: inductance,
      conductorCurrents,
      transposedCurrents,
    }),
    totalSkinResistanceOhmsPerMeterPerSqrtHz: projectMatrix({
      matrix: totalSkinResistanceOhmsPerMeterPerSqrtHz,
      conductorCurrents,
      transposedCurrents,
    }),
    conductorSkinResistanceOhmsPerMeterPerSqrtHz: projectMatrix({
      matrix: conductorSkinResistanceOhmsPerMeterPerSqrtHz,
      conductorCurrents,
      transposedCurrents,
    }),
  })
}

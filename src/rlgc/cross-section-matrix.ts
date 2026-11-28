import type { Matrix } from "../kernel"
import { fail } from "./diagnostics"

const DEFAULT_STRICT_PASSIVITY = false

/** A pivot below this magnitude cannot support a stable division in the boundary solve. */
const MIN_PIVOT_MAGNITUDE = 1e-20

/** Allow matrix roundoff relative to the largest coefficient when checking passivity. */
const PASSIVITY_RELATIVE_TOLERANCE = 1e-9

/** Zero-filled square matrix in conductor order. */
export function createZeroMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => Array(size).fill(0))
}

/** Partial-pivoted LU factors and row swaps for reuse across excitations. */
interface BoundaryFactors {
  matrix: Float64Array[]
  swaps: Int32Array
}

/** Factor a copy of the boundary matrix. */
export function factorBoundaryMatrix(
  boundaryMatrix: Float64Array[],
): BoundaryFactors {
  const matrix = boundaryMatrix.map((row) => row.slice())
  const n = matrix.length
  const swaps = new Int32Array(n)
  for (let k = 0; k < n; k++) {
    let pivot = k
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(matrix[i][k]) > Math.abs(matrix[pivot][k])) pivot = i
    }
    const pivotCoefficient = matrix[pivot][k]
    if (
      !Number.isFinite(pivotCoefficient) ||
      Math.abs(pivotCoefficient) < MIN_PIVOT_MAGNITUDE
    ) {
      fail({
        code: "matrix_zero",
        text: "Singular cross-section boundary matrix",
      })
    }
    swaps[k] = pivot
    const row = matrix[k]
    matrix[k] = matrix[pivot]
    matrix[pivot] = row
    for (let i = k + 1; i < n; i++) {
      const factor = matrix[i][k] / matrix[k][k]
      matrix[i][k] = factor
      for (let j = k + 1; j < n; j++) matrix[i][j] -= factor * matrix[k][j]
    }
  }
  return { matrix, swaps }
}

/** Apply the saved factors without changing the right-hand sides. */
export function solveBoundarySystem({
  factors: { matrix, swaps },
  rightHandSides,
}: {
  factors: BoundaryFactors
  rightHandSides: Matrix
}): Matrix {
  const n = matrix.length
  const result = rightHandSides.map((row) => [...row])
  const m = result[0].length
  for (let k = 0; k < n; k++) {
    const row = result[k]
    result[k] = result[swaps[k]]
    result[swaps[k]] = row
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < i; k++) {
      for (let j = 0; j < m; j++) result[i][j] -= matrix[i][k] * result[k][j]
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j < m; j++) {
      for (let k = i + 1; k < n; k++)
        result[i][j] -= matrix[i][k] * result[k][j]
      result[i][j] /= matrix[i][i]
    }
  }
  return result
}

/** Inverse of a conductor matrix (not of the field operator). */
export function calculateMatrixInverse(matrix: Matrix): Matrix {
  const rightHandSides = matrix.map((row, i) =>
    row.map((_, j) => Number(i === j)),
  )
  const factors = factorBoundaryMatrix(
    matrix.map((row) => Float64Array.from(row)),
  )
  return solveBoundarySystem({ factors, rightHandSides })
}

/** Maximum unprojected reciprocity error, scaled by the largest matrix coefficient. */
export function calculateReciprocityResidual(matrix: Matrix): number {
  let residual = 0
  let largest = 0
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix.length; j++) {
      residual = Math.max(residual, Math.abs(matrix[i][j] - matrix[j][i]))
      largest = Math.max(largest, Math.abs(matrix[i][j]))
    }
  }
  if (largest === 0) return 0
  return residual / largest
}

/** Reject nonphysical matrices before frequency interpolation; permit exact lossless null spaces. */
export function assertMatrixPassive({
  matrix,
  isStrict = DEFAULT_STRICT_PASSIVITY,
}: {
  matrix: Matrix
  isStrict?: boolean
}): void {
  const size = matrix.length
  let largest = -Infinity
  for (const row of matrix) {
    for (const coefficient of row) {
      largest = Math.max(largest, Math.abs(coefficient))
    }
  }
  if (!Number.isFinite(largest))
    fail({ code: "matrix_format", text: "Nonfinite cross-section coefficient" })
  if (calculateReciprocityResidual(matrix) > PASSIVITY_RELATIVE_TOLERANCE)
    fail({
      code: "reciprocity",
      text: "Cross-section passivity requires a symmetric matrix",
    })
  if (largest === 0 && !isStrict) return
  // Normalize before adding the diagonal shift so the tolerance remains representable.
  // For loss matrices this tests A + tolerance * I, allowing eigenvalues within roundoff of zero.
  const scale = largest || 1
  const tolerance = PASSIVITY_RELATIVE_TOLERANCE
  const factor = matrix.map((row) => row.map(() => 0))
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      let coefficient = matrix[i][j] / scale
      if (i === j && !isStrict) coefficient += tolerance
      for (let k = 0; k < j; k++) coefficient -= factor[i][k] * factor[j][k]
      if (i === j) {
        if (coefficient < 0 || (isStrict && coefficient <= tolerance)) {
          fail({
            code: "passivity",
            text: "Cross-section matrix has nonpositive field energy; refine the mesh",
          })
        }
        factor[i][j] = Math.sqrt(Math.max(0, coefficient))
        continue
      }
      if (factor[j][j]) {
        factor[i][j] = coefficient / factor[j][j]
        continue
      }
      if (Math.abs(coefficient) > tolerance)
        fail({
          code: "passivity",
          text: "Cross-section loss matrix has an invalid null space",
        })
    }
  }
}

import { fail } from "./diagnostics"
import type { Matrix } from "./linalg"

const DEFAULT_STRICT_PASSIVITY = false

/** A pivot below this magnitude cannot support a stable division in the boundary solve. */
const MIN_PIVOT_MAGNITUDE = 1e-20

/** Allow matrix roundoff relative to the largest coefficient when checking passivity. */
const PASSIVITY_RELATIVE_TOLERANCE = 1e-9

/** Solves a matrix of right-hand sides using saved boundary factors. */
type SectionMatrixSolve = (values: Matrix) => Matrix

/** In-place partial-pivoted LU of a small boundary matrix; reuse for every excitation/sensitivity. */
export function sectionFactor(matrix: Float64Array[]): SectionMatrixSolve {
  const n = matrix.length
  const swaps = new Int32Array(n)
  for (let k = 0; k < n; k++) {
    let pivot = k
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(matrix[i][k]) > Math.abs(matrix[pivot][k])) pivot = i
    }
    const pivotValue = matrix[pivot][k]
    if (
      !Number.isFinite(pivotValue) ||
      Math.abs(pivotValue) < MIN_PIVOT_MAGNITUDE
    ) {
      fail("matrix_zero", "Singular cross-section boundary matrix")
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
  /** Solve using the saved factors without changing the right-hand side. */
  const solve = (values: Matrix): Matrix => {
    const result = values.map((row) => [...row])
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
  return solve
}

/** Inverse of a conductor matrix (not of the field operator). */
export function sectionInverse(matrix: Matrix): Matrix {
  const rhs = matrix.map((row, i) => row.map((_, j) => Number(i === j)))
  return sectionFactor(matrix.map((row) => Float64Array.from(row)))(rhs)
}

/** Maximum unprojected reciprocity error, scaled by the largest matrix coefficient. */
export function sectionReciprocity(matrix: Matrix): number {
  let residual = 0
  let largest = 0
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix.length; j++) {
      residual = Math.max(residual, Math.abs(matrix[i][j] - matrix[j][i]))
      largest = Math.max(largest, Math.abs(matrix[i][j]))
    }
  }
  if (!largest) return 0
  return residual / largest
}

/** Reject nonphysical matrices before frequency interpolation; permit exact lossless null spaces. */
export function sectionPassive({
  matrix,
  strict = DEFAULT_STRICT_PASSIVITY,
}: {
  matrix: Matrix
  strict?: boolean
}): void {
  const size = matrix.length
  const largest = Math.max(...matrix.flat().map(Math.abs))
  if (!Number.isFinite(largest))
    fail("matrix_format", "Nonfinite cross-section coefficient")
  const tolerance = largest * PASSIVITY_RELATIVE_TOLERANCE
  const factor = matrix.map((row) => row.map(() => 0))
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      let coefficient = matrix[i][j]
      for (let k = 0; k < j; k++) coefficient -= factor[i][k] * factor[j][k]
      if (i === j) {
        if (coefficient < -tolerance || (strict && coefficient <= tolerance)) {
          fail(
            "passivity",
            "Cross-section matrix has nonpositive field energy; refine the mesh",
          )
        }
        factor[i][j] = Math.sqrt(Math.max(0, coefficient))
        continue
      }
      if (factor[j][j]) {
        factor[i][j] = coefficient / factor[j][j]
        continue
      }
      if (Math.abs(coefficient) > tolerance)
        fail("passivity", "Cross-section loss matrix has an invalid null space")
    }
  }
}

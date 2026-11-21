import type { Matrix } from "../../src/extraction"

// Shared helpers for the golden known-answer checks (docs/golden-checks.md). They only measure;
// every expected value and tolerance lives beside its check, with its source.

/** Bound the cyclic Jacobi solve to a fixed number of sweeps. */
const MAX_JACOBI_SWEEPS = 60

/** Stop when the largest off-diagonal entry falls below this share of the input scale. */
const JACOBI_RELATIVE_TOLERANCE = 1e-15

/** Avoid dividing by a near-underflow off-diagonal coefficient. */
const MIN_JACOBI_COEFFICIENT = 1e-300

/**
 * Eigenvalues of a real symmetric matrix, ascending, by cyclic Jacobi rotations
 * (Golub & Van Loan, Matrix Computations, 4th ed., §8.5.2). Independent of production linear algebra.
 */
export function symmetricEigenvalues(matrix: Matrix): number[] {
  const n = matrix.length
  const a = matrix.map((row) => [...row])
  const scale = Math.max(...a.flat().map(Math.abs)) || 1
  for (let sweep = 0; sweep < MAX_JACOBI_SWEEPS; sweep++) {
    let largest = 0
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++)
        largest = Math.max(largest, Math.abs(a[p][q]))
    }
    if (largest <= JACOBI_RELATIVE_TOLERANCE * scale) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) <= MIN_JACOBI_COEFFICIENT) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        let sign = -1
        if (theta >= 0) sign = 1
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const kp = a[k][p]
          const kq = a[k][q]
          a[k][p] = c * kp - s * kq
          a[k][q] = s * kp + c * kq
        }
        for (let k = 0; k < n; k++) {
          const pk = a[p][k]
          const qk = a[q][k]
          a[p][k] = c * pk - s * qk
          a[q][k] = s * pk + c * qk
        }
      }
    }
  }
  return a.map((row, i) => row[i]).sort((x, y) => x - y)
}

/** Row and column of a matrix coefficient. */
type MatrixIndexPair = [row: number, column: number]

/** Measured energy-matrix facts: asymmetry, extreme eigenvalues and the strongest pairwise coupling. */
export interface EnergyFacts {
  asymmetry: number
  minimumEigenvalue: number
  maximumEigenvalue: number
  coupling: number
  pair: MatrixIndexPair
}

/** Relative asymmetry, eigenvalue range and max |M_ij|/sqrt(M_ii M_jj) of a square matrix. */
export function energyFacts(matrix: Matrix): EnergyFacts {
  const scale = Math.max(...matrix.flat().map(Math.abs)) || 1
  let asymmetry = 0
  let coupling = 0
  let pair: MatrixIndexPair = [0, 0]
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix.length; j++) {
      asymmetry = Math.max(
        asymmetry,
        Math.abs(matrix[i][j] - matrix[j][i]) / scale,
      )
      if (i === j || !(matrix[i][i] > 0 && matrix[j][j] > 0)) continue
      const k = Math.abs(matrix[i][j]) / Math.sqrt(matrix[i][i] * matrix[j][j])
      if (k > coupling) {
        coupling = k
        pair = [i, j]
      }
    }
  }
  const values = symmetricEigenvalues(
    matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2)),
  )
  return {
    asymmetry,
    minimumEigenvalue: values[0],
    maximumEigenvalue: values.at(-1)!,
    coupling,
    pair,
  }
}

/** Extremal entries and relative row sum for a Maxwell (grounded) capacitance matrix. */
interface MaxwellFacts {
  minimumDiagonal: number
  maximumOffDiagonal: number
  minimumRowSum: number
}

/** Find the smallest diagonal, largest off-diagonal and smallest row sum relative to its diagonal. */
export function maxwellFacts(matrix: Matrix): MaxwellFacts {
  let minimumDiagonal = Infinity
  let maximumOffDiagonal = -Infinity
  let minimumRowSum = Infinity
  for (const [i, row] of matrix.entries()) {
    minimumDiagonal = Math.min(minimumDiagonal, row[i])
    for (const [j, value] of row.entries()) {
      if (i !== j) maximumOffDiagonal = Math.max(maximumOffDiagonal, value)
    }
    minimumRowSum = Math.min(
      minimumRowSum,
      row.reduce((sum, value) => sum + value, 0) / row[i],
    )
  }
  if (matrix.length <= 1) maximumOffDiagonal = 0
  return { minimumDiagonal, maximumOffDiagonal, minimumRowSum }
}

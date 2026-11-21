import type { Matrix } from "../extraction"
import type { PackageModel } from "./package-model"

/** Threshold for near-zero pivots in the scale-normalized LDL factorization. */
const PIVOT_TOLERANCE = 1e-12

/** Original diagonal terms for the selected physical pins. */
interface PackageSelfTerms {
  R: number[]
  L: number[]
  C: number[]
}

/** Evidence for conversion from vendor pair magnitudes to Maxwell capacitance. */
interface CapacitanceSignCorrection {
  packageModel: PackageModel["name"]
  negatedEntries: number
}

/** Reduced package matrices and the original data needed to explain their construction. */
export interface SelectedPackageModel
  extends Pick<PackageModel, "pins" | "R" | "L" | "C"> {
  unusedPins: PackageModel["pins"]
  selfTerms: PackageSelfTerms
  capacitanceSignCorrection?: CapacitanceSignCorrection
}

/** Scale-normalized LDL factorization: L/C must be definite, R may be semidefinite. */
function checkPositive({
  matrix,
  label,
  strict,
}: {
  matrix: Matrix
  label: string
  strict: boolean
}): void {
  let requirement = "semidefinite"
  if (strict) requirement = "definite"
  const size = matrix.length
  const invalidRow = matrix.some(
    (row) =>
      row.length !== size || row.some((value) => !Number.isFinite(value)),
  )
  if (invalidRow) throw new Error(`${label}: finite square matrix required`)
  if (matrix.some((row, i) => row[i] < 0)) {
    throw new Error(
      `${label}: negative diagonal; matrix is not positive ${requirement}`,
    )
  }
  const scale = Math.max(...matrix.map((row, i) => Math.abs(row[i])))
  const work = matrix.map((row) =>
    row.map((coefficient) => coefficient / (scale || 1)),
  )
  for (let k = 0; k < size; k++) {
    const pivot = work[k][k]
    const nearZero = pivot <= PIVOT_TOLERANCE
    const nonzeroColumn =
      nearZero &&
      !strict &&
      work.slice(k + 1).some((row) => Math.abs(row[k]) > PIVOT_TOLERANCE)
    if (pivot < -PIVOT_TOLERANCE || (nearZero && strict) || nonzeroColumn) {
      throw new Error(
        `${label}: matrix is not positive ${requirement} at pivot ${k + 1}; passive package required`,
      )
    }
    if (nearZero) continue
    for (let i = k + 1; i < size; i++) {
      for (let j = i; j < size; j++) {
        work[i][j] -= (work[i][k] * work[j][k]) / pivot
        work[j][i] = work[i][j]
      }
    }
  }
}

/** Reject sign conventions that cannot be realized with passive pair/reference capacitors. */
function checkCapacitance({
  matrix,
  label,
}: {
  matrix: Matrix
  label: string
}): void {
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i]
    if (row.some((capacitance, j) => i !== j && capacitance > 0)) {
      const requirement =
        "correction requires uniformly positive couplings and diagonally dominant rows"
      throw new Error(
        `${label}: Maxwell capacitance has positive off-diagonal entries; ${requirement}`,
      )
    }
    const reference = row.reduce((sum, capacitance) => sum + capacitance, 0)
    if (reference < 0)
      throw new Error(
        `${label}: negative reference capacitance (Maxwell row sum)`,
      )
  }
}

/**
 * Open unused series leads (zero current) select principal R/L. Float unused
 * electrostatic conductors (zero incremental charge) by Schur reduction of C.
 * External loads, switching and resonant circulating currents on unused pins are neglected.
 */
export function selectPackageModel({
  model,
  pins,
}: {
  model: PackageModel
  pins: PackageModel["pins"]
}): SelectedPackageModel {
  if (new Set(pins).size !== pins.length)
    throw new Error(`${model.name}: distinct selected package pins required`)
  const indices = pins.map((pin) => {
    const index = model.pins.indexOf(pin)
    if (index < 0) {
      const detail = `selected package pin ${pin} missing from [Pin Numbers]`
      throw new Error(`${model.name}: ${detail}; scalar fallback is forbidden`)
    }
    return index
  })
  checkPositive({
    matrix: model.R,
    label: `${model.name} resistance`,
    strict: false,
  })
  checkPositive({
    matrix: model.L,
    label: `${model.name} inductance`,
    strict: true,
  })
  const offDiagonal = model.C.flatMap((row, i) =>
    row.filter((capacitance, j) => i !== j && capacitance !== 0),
  )
  const uniformlyPositive =
    offDiagonal.length > 0 &&
    offDiagonal.every((capacitance) => capacitance > 0)
  const correct =
    uniformlyPositive &&
    model.C.every((row, i) => {
      const coupling = row.reduce((sum, capacitance, j) => {
        if (i === j) return sum
        return sum + Math.abs(capacitance)
      }, 0)
      return row[i] >= coupling
    })
  const C = model.C.map((row, i) =>
    row.map((capacitance, j) => {
      if (correct && i !== j && capacitance !== 0) return -capacitance
      return capacitance
    }),
  )
  checkPositive({ matrix: C, label: `${model.name} capacitance`, strict: true })
  checkCapacitance({ matrix: C, label: model.name })
  const unused = model.pins.map((_, i) => i).filter((i) => !indices.includes(i))
  const work = C.map((row) => [...row])
  let active = model.pins.map((_, i) => i)
  for (const k of unused) {
    active = active.filter((i) => i !== k)
    for (const i of active) {
      for (const j of active) {
        work[i][j] -= (work[i][k] * work[k][j]) / work[k][k]
      }
    }
  }
  const selected: SelectedPackageModel = {
    pins,
    unusedPins: unused.map((i) => model.pins[i]),
    R: indices.map((i) => indices.map((j) => model.R[i][j])),
    L: indices.map((i) => indices.map((j) => model.L[i][j])),
    C: indices.map((i) => indices.map((j) => work[i][j])),
    selfTerms: {
      R: indices.map((i) => model.R[i][i]),
      L: indices.map((i) => model.L[i][i]),
      C: indices.map((i) => model.C[i][i]),
    },
  }
  checkPositive({
    matrix: selected.L,
    label: `${model.name} extracted inductance`,
    strict: true,
  })
  checkPositive({
    matrix: selected.C,
    label: `${model.name} extracted capacitance`,
    strict: true,
  })
  checkCapacitance({ matrix: selected.C, label: `${model.name} extracted` })
  if (correct)
    selected.capacitanceSignCorrection = {
      packageModel: model.name,
      negatedEntries: offDiagonal.length,
    }
  return selected
}

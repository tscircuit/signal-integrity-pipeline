// Shared helpers for the golden known-answer checks (docs/golden-checks.md). They only measure;
// every expected value and tolerance lives beside its check, with its source.
import { accessSync, constants } from "node:fs"
import { readFile } from "node:fs/promises"
import { delimiter, join } from "node:path"
import type { TestContext } from "node:test"
import { createNativeSolver } from "../../src/adapters"
import type { Matrix } from "../../src/extraction"

/** Local vendor IBIS bytes are never committed: skip cleanly unless IBIS_MODEL_DIR holds `file`. */
export async function vendorText(
  context: TestContext,
  file: string,
): Promise<string | undefined> {
  if (!process.env.IBIS_MODEL_DIR) {
    context.skip(
      `Set IBIS_MODEL_DIR to local vendor ${file}; vendor bytes are not committed`,
    )
    return
  }
  try {
    return await readFile(join(process.env.IBIS_MODEL_DIR, file), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    context.skip(`Local vendor ${file} is unavailable`)
    return
  }
}

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

/** The relative floating-point tolerance for energy-matrix symmetry and loss eigenvalues. */
const MATRIX_TOLERANCE = 1e-12
/** Allow tiny negative Maxwell row sums introduced by floating-point reduction. */
const MAXWELL_ROW_SUM_TOLERANCE = 1e-9
/** Below and at 50 MHz the interpolation of the conductor crossover has a wider error band. */
const CROSSOVER_BAND_LIMIT_HZ = 5e7
const CROSSOVER_ERROR = 0.1
const HIGH_FREQUENCY_ERROR = 0.05

/** Positive definite energy matrix with every pairwise coupling strictly below one. */
export function isPositiveDefinite(facts: EnergyFacts): boolean {
  return (
    facts.asymmetry <= MATRIX_TOLERANCE &&
    facts.minimumEigenvalue > 0 &&
    facts.coupling < 1
  )
}

/** Grounded Maxwell capacitance with nonnegative row sums and the requested off-diagonal bound. */
export function isGroundedMaxwell(
  facts: MaxwellFacts,
  strictOffDiagonalLimit?: number,
): boolean {
  let validOffDiagonal = facts.maximumOffDiagonal <= 0
  if (strictOffDiagonalLimit !== undefined)
    validOffDiagonal = facts.maximumOffDiagonal < strictOffDiagonalLimit
  return (
    facts.minimumDiagonal > 0 &&
    validOffDiagonal &&
    facts.minimumRowSum >= -MAXWELL_ROW_SUM_TOLERANCE
  )
}

/** Positive semidefinite loss matrix to floating-point tolerance, with nonnegative diagonal. */
export function hasNonnegativeLoss(
  matrix: readonly (readonly number[])[],
  facts: EnergyFacts,
): boolean {
  const minimum = -MATRIX_TOLERANCE * Math.abs(facts.maximumEigenvalue)
  return (
    matrix.every((row, i) => row[i] >= 0) && facts.minimumEigenvalue >= minimum
  )
}

/** Relative tolerance for the ladder or field solver against the filament reference. */
export function conductorLossTolerance(frequency: number): number {
  if (frequency <= CROSSOVER_BAND_LIMIT_HZ) return CROSSOVER_ERROR
  return HIGH_FREQUENCY_ERROR
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

/** True only when an ngspice executable is on PATH; native golden checks skip cleanly otherwise. */
export function ngspiceAvailable(): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((directory) => {
    try {
      accessSync(join(directory, "ngspice"), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

/** ASCII letters, digits and underscore count as part of a diagnostic word. */
function isDiagnosticWordCharacter(character = ""): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9") ||
    character === "_"
  )
}

/** Recognize ngspice's failure messages when bounded by non-word characters. */
function hasGoldenDiagnostic(line: string): boolean {
  const messages = ["error", "fatal", "aborted", "timestep too small"]
  for (let start = 0; start < line.length; start++) {
    if (isDiagnosticWordCharacter(line[start - 1])) continue
    for (const message of messages) {
      const end = start + message.length
      if (
        line.slice(start, end).toLowerCase() === message &&
        !isDiagnosticWordCharacter(line[end])
      )
        return true
    }
  }
  return false
}

/** Find the first diagnostic across LF and CRLF native output. */
function goldenDiagnostic(output: string): string | undefined {
  return output.replaceAll("\r\n", "\n").split("\n").find(hasGoldenDiagnostic)
}

/** Parse one wrdata row, advancing past each run of whitespace between fields. */
function parseGoldenRow(line: string): number[] {
  const row = line.trim()
  const values: number[] = []
  let start = 0
  for (let index = 0; index < row.length; index++) {
    if (row[index].trim() !== "") continue
    values.push(Number(row.slice(start, index)))
    while (index + 1 < row.length && row[index + 1].trim() === "") index++
    start = index + 1
  }
  values.push(Number(row.slice(start)))
  return values
}

/**
 * Run one small deck through the repo's sequential native adapter (OMP_NUM_THREADS=1) and return
 * its `wrdata golden.dat ...` rows: time (or sweep) first, then each saved vector.
 */
export async function runGoldenDeck(deck: string): Promise<number[][]> {
  const run = createNativeSolver({ timeoutMs: 120_000 })
  const output = await run({
    solver: "ngspice",
    files: { "golden.cir": deck },
    args: ["-n", "-b", "golden.cir"],
    outputFiles: ["golden.dat"],
  })
  const diagnostic = goldenDiagnostic(`${output.stdout}\n${output.stderr}`)
  if (diagnostic) throw new Error(`ngspice: ${diagnostic}`)
  const text = output.files["golden.dat"]
  if (!text) throw new Error("ngspice wrote no golden.dat")
  return text.trim().split("\n").slice(1).map(parseGoldenRow)
}

/** Linear interpolation of column `column` at `time` over ascending time rows. */
export function valueAt(
  rows: number[][],
  column: number,
  time: number,
): number {
  if (time <= rows[0][0]) return rows[0][column]
  for (let i = 1; i < rows.length; i++)
    if (rows[i][0] >= time) {
      const span = rows[i][0] - rows[i - 1][0]
      if (!span) return rows[i][column]
      const before = rows[i - 1][column]
      const change = rows[i][column] - before
      const elapsed = time - rows[i - 1][0]
      return before + (change * elapsed) / span
    }
  return rows.at(-1)![column]
}

/** First time after `after` at which column `column` crosses `level` (linear interpolation), or NaN. */
export function crossingTime(
  rows: number[][],
  column: number,
  level: number,
  after = -Infinity,
): number {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] <= after) continue
    const a = rows[i - 1][column] - level
    const b = rows[i][column] - level
    if (a === 0) return rows[i - 1][0]
    if (a * b < 0 || b === 0)
      return rows[i - 1][0] + ((rows[i][0] - rows[i - 1][0]) * a) / (a - b)
  }
  return NaN
}

/** One rectangular strip between two flat copper reference planes at z = 0 and z = b (SI units, x is the centre). */
export interface FilamentStrip {
  xM: number
  widthM: number
  thicknessM: number
  bottomM: number
}
/** Strips between two planes of thickness `planeThicknessM` (Infinity for copper half-spaces) at spacing `spacingM`. */
export interface FilamentLine {
  strips: FilamentStrip[]
  spacingM: number
  planeThicknessM: number
  conductivity: number
}
/**
 * Cells per strip: `x` across the width and `z` through the thickness (both even), geometric growth away from
 * the faces.
 */
export interface FilamentCells {
  x: number
  z: number
  xRatio: number
  zRatio: number
}

/** Geometric cell edges on [0, length], `count` cells (even), finest at both ends with growth `ratio`. */
function gradedEdges(length: number, count: number, ratio: number): number[] {
  const half = Array.from({ length: count / 2 }, (_, i) => ratio ** i)
  const sizes = [...half, ...[...half].reverse()]
  const total = sizes.reduce((sum, size) => sum + size, 0)
  const edges = [0]
  for (const size of sizes) edges.push(edges.at(-1)! + (size * length) / total)
  return edges
}

/** Fourth antiderivative of ln r: d^4 F / dx^2 dz^2 = ln sqrt(x^2 + z^2). */
function logPrimitive(x: number, z: number): number {
  const r2 = x * x + z * z
  const log = r2 > 0 ? Math.log(r2) / 2 : 0
  const a = x !== 0 ? Math.atan(z / x) : 0
  const b = z !== 0 ? Math.atan(x / z) : 0
  return (
    -(
      (x ** 4 - 6 * x * x * z * z + z ** 4) * (log - 25 / 12) -
      4 * x ** 3 * z * a -
      4 * x * z ** 3 * b
    ) / 24
  )
}

/** Rectangle [x0, x1] x [z0, z1]. */
interface FilamentCell {
  x0: number
  x1: number
  z0: number
  z1: number
}

/**
 * Exact mean of ln r between two rectangles: the closed-form primitive differenced over the 16 corner pairs, exact
 * for any aspect ratio (the self term is Maxwell's geometric mean distance). Far pairs, where the differences
 * cancel, use the centre distance.
 */
function meanLogDistance(a: FilamentCell, c: FilamentCell): number {
  const distance = Math.hypot(
    (a.x0 + a.x1 - c.x0 - c.x1) / 2,
    (a.z0 + a.z1 - c.z0 - c.z1) / 2,
  )
  if (
    distance >
    40 * Math.max(a.x1 - a.x0, a.z1 - a.z0, c.x1 - c.x0, c.z1 - c.z0)
  )
    return Math.log(distance)
  let total = 0
  for (const [ax, sa] of [
    [a.x0, 1],
    [a.x1, -1],
  ]) {
    for (const [cx, sc] of [
      [c.x0, 1],
      [c.x1, -1],
    ]) {
      for (const [az, ta] of [
        [a.z0, 1],
        [a.z1, -1],
      ]) {
        for (const [cz, tc] of [
          [c.z0, 1],
          [c.z1, -1],
        ]) {
          total += sa * sc * ta * tc * logPrimitive(ax - cx, az - cz)
        }
      }
    }
  }
  return total / ((a.x1 - a.x0) * (a.z1 - a.z0) * (c.x1 - c.x0) * (c.z1 - c.z0))
}

/** Matrix with its real and imaginary rows stored separately. */
interface ComplexRows {
  re: Float64Array[]
  im: Float64Array[]
}

/** Complex Gaussian elimination of A X = B (A n x n, B n x m, split real/imaginary rows, overwritten); returns X. */
function complexSolve(
  { re, im }: ComplexRows,
  { re: bre, im: bim }: ComplexRows,
): ComplexRows {
  const n = re.length
  const m = bre[0].length
  for (let k = 0; k < n; k++) {
    const pivot = re[k][k] ** 2 + im[k][k] ** 2
    for (let i = k + 1; i < n; i++) {
      const mr = (re[i][k] * re[k][k] + im[i][k] * im[k][k]) / pivot
      const mi = (im[i][k] * re[k][k] - re[i][k] * im[k][k]) / pivot
      const rowRe = re[i]
      const rowIm = im[i]
      const pivotRe = re[k]
      const pivotIm = im[k]
      for (let j = k; j < n; j++) {
        rowRe[j] -= mr * pivotRe[j] - mi * pivotIm[j]
        rowIm[j] -= mr * pivotIm[j] + mi * pivotRe[j]
      }
      for (let j = 0; j < m; j++) {
        const r = bre[k][j]
        const s = bim[k][j]
        bre[i][j] -= mr * r - mi * s
        bim[i][j] -= mr * s + mi * r
      }
    }
  }
  const xre = bre.map(() => new Float64Array(m))
  const xim = bre.map(() => new Float64Array(m))
  for (let k = n - 1; k >= 0; k--) {
    for (let j = 0; j < m; j++) {
      let sr = bre[k][j]
      let si = bim[k][j]
      for (let l = k + 1; l < n; l++) {
        sr -= re[k][l] * xre[l][j] - im[k][l] * xim[l][j]
        si -= re[k][l] * xim[l][j] + im[k][l] * xre[l][j]
      }
      const pivot = re[k][k] ** 2 + im[k][k] ** 2
      xre[k][j] = (sr * re[k][k] + si * im[k][k]) / pivot
      xim[k][j] = (si * re[k][k] - sr * im[k][k]) / pivot
    }
  }
  return { re: xre, im: xim }
}

/** Frequency sweep and optional mesh for the independent filament reference. */
interface FilamentSweep {
  frequencies: number[]
  cells?: FilamentCells
}

/** Series resistance and inductance per metre at one frequency. */
interface FilamentImpedancePoint {
  frequency: number
  R: number[][]
  L: number[][]
}

/** Mesh density and grading for the default reference calculation. */
const DEFAULT_FILAMENT_CELLS: FilamentCells = {
  x: 48,
  z: 20,
  xRatio: 1.13,
  zRatio: 1.3,
}

/**
 * Per-unit-length series impedance matrix of `line.strips` by the filament (PEEC) method of Weeks, Wu, McAllister &
 * Singh, "Resistive and inductive skin effect in rectangular conductors", IBM J. Res. Dev. 23 (1979) 652–660.
 * Independent of the production solver. Each strip is cut into graded uniform-current cells; cells couple through the
 * vector-potential Green function between two perfect planes, (mu0/4pi) ln[(cosh U - cos V+)/(cosh U - cos V-)],
 * U = pi dx/b, V± = pi (z ± z')/b, whose free-space part is integrated exactly over each cell pair (meanLogDistance)
 * and whose smooth image part is taken at cell centres. All cells of one strip share one longitudinal field.
 * Plane loss is a surface-impedance perturbation, not a plane solve: the solved cell currents induce
 * K(x) = I sin(a)/(2b (cosh(pi dx/b) - cos a)) on each plane, and a plane of thickness t_p has surface impedance
 * Zs = (1 + j)/(sigma delta) coth((1 + j) t_p/delta), so Z_plane = Zs ∫ K^H K dx. Returns R (ohm/m) and L (H/m).
 */
export function filamentImpedance(
  line: FilamentLine,
  sweep: FilamentSweep,
): FilamentImpedancePoint[] {
  const { frequencies, cells = DEFAULT_FILAMENT_CELLS } = sweep
  const mu0 = 1.25663706212e-6
  const b = line.spacingM
  const p = Math.PI / b
  const count = line.strips.length
  const parts: (FilamentCell & {
    x: number
    z: number
    strip: number
  })[] = []
  for (const [k, strip] of line.strips.entries()) {
    const xs = gradedEdges(strip.widthM, cells.x, cells.xRatio).map(
      (x) => x + strip.xM - strip.widthM / 2,
    )
    const zs = gradedEdges(strip.thicknessM, cells.z, cells.zRatio).map(
      (z) => z + strip.bottomM,
    )
    for (let i = 0; i < cells.x; i++) {
      for (let j = 0; j < cells.z; j++) {
        parts.push({
          x0: xs[i],
          x1: xs[i + 1],
          z0: zs[j],
          z1: zs[j + 1],
          x: (xs[i] + xs[i + 1]) / 2,
          z: (zs[j] + zs[j + 1]) / 2,
          strip: k,
        })
      }
    }
  }
  const n = parts.length
  /** Image sum minus the free-space singularity, finite as r -> 0. */
  const images = (
    a: {
      x: number
      z: number
    },
    c: {
      x: number
      z: number
    },
  ): number => {
    const r2 = (a.x - c.x) ** 2 + (a.z - c.z) ** 2
    const near =
      r2 < 1e-30
        ? (p * p) / 2
        : (Math.cosh(p * (a.x - c.x)) - Math.cos(p * (a.z - c.z))) / r2
    return (
      (mu0 / (4 * Math.PI)) *
      (Math.log(Math.cosh(p * (a.x - c.x)) - Math.cos(p * (a.z + c.z))) -
        Math.log(near))
    )
  }
  const inductance = parts.map(() => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      inductance[i][j] =
        (-mu0 / (2 * Math.PI)) * meanLogDistance(parts[i], parts[j]) +
        images(parts[i], parts[j])
      inductance[j][i] = inductance[i][j]
    }
  }
  const step = b / 200
  const centre = line.strips.reduce((sum, strip) => sum + strip.xM, 0) / count
  const samples = Array.from(
    { length: 4801 },
    (_, i) => centre - 12 * b + i * step,
  )
  return frequencies.map((frequency) => {
    const omega = 2 * Math.PI * frequency
    const re = parts.map((part, i) => {
      const width = part.x1 - part.x0
      const thickness = part.z1 - part.z0
      const resistance = 1 / (line.conductivity * width * thickness)
      return Float64Array.from({ length: n }, (_, j) =>
        i === j ? resistance : 0,
      )
    })
    const im = inductance.map((row) => row.map((value) => omega * value))
    // Unit longitudinal field on strip k only: cell currents Y = Zf^-1 E, strip currents M = E^T Y, impedance M^-1.
    const field = parts.map((part) =>
      Float64Array.from({ length: count }, (_, k) => Number(part.strip === k)),
    )
    const imaginaryField = parts.map(() => new Float64Array(count))
    const admittance = complexSolve(
      { re, im },
      { re: field, im: imaginaryField },
    )
    const sums = {
      re: line.strips.map(() => new Float64Array(count)),
      im: line.strips.map(() => new Float64Array(count)),
    }
    for (const [i, part] of parts.entries()) {
      for (let k = 0; k < count; k++) {
        sums.re[part.strip][k] += admittance.re[i][k]
        sums.im[part.strip][k] += admittance.im[i][k]
      }
    }
    const identity = {
      re: line.strips.map((_, i) =>
        Float64Array.from({ length: count }, (_, j) => Number(i === j)),
      ),
      im: line.strips.map(() => new Float64Array(count)),
    }
    const impedance = complexSolve(sums, identity)
    // Cell currents for unit strip currents: Y M^-1.
    const current = parts.map((_, i) =>
      line.strips.map((_, l) => {
        let r = 0
        let s = 0
        for (let k = 0; k < count; k++) {
          r +=
            admittance.re[i][k] * impedance.re[k][l] -
            admittance.im[i][k] * impedance.im[k][l]
          s +=
            admittance.re[i][k] * impedance.im[k][l] +
            admittance.im[i][k] * impedance.re[k][l]
        }
        return [r, s]
      }),
    )
    const delta = 1 / Math.sqrt(Math.PI * frequency * mu0 * line.conductivity)
    // coth(u + ju) = (sinh 2u - j sin 2u)/(cosh 2u - cos 2u), u = t_p/delta; a half-space has coth = 1.
    const u = line.planeThicknessM / delta
    const finite = Number.isFinite(u) && u < 40
    const cothRe = finite
      ? Math.sinh(2 * u) / (Math.cosh(2 * u) - Math.cos(2 * u))
      : 1
    const cothIm = finite
      ? -Math.sin(2 * u) / (Math.cosh(2 * u) - Math.cos(2 * u))
      : 0
    const surfaceRe = (cothRe - cothIm) / (line.conductivity * delta)
    const surfaceIm = (cothRe + cothIm) / (line.conductivity * delta)
    const plane = {
      re: line.strips.map(() => Array(count).fill(0)),
      im: line.strips.map(() => Array(count).fill(0)),
    }
    const sheet = line.strips.map(() => [0, 0])
    for (const x of samples) {
      for (const top of [false, true]) {
        for (const entry of sheet) entry.fill(0)
        for (const [i, part] of parts.entries()) {
          const angle = p * (top ? b - part.z : part.z)
          const kernel =
            Math.sin(angle) /
            (2 * b * (Math.cosh(p * (x - part.x)) - Math.cos(angle)))
          for (let l = 0; l < count; l++) {
            sheet[l][0] += current[i][l][0] * kernel
            sheet[l][1] += current[i][l][1] * kernel
          }
        }
        for (let k = 0; k < count; k++) {
          for (let l = 0; l < count; l++) {
            const r = sheet[k][0] * sheet[l][0] + sheet[k][1] * sheet[l][1]
            const s = sheet[k][0] * sheet[l][1] - sheet[k][1] * sheet[l][0]
            plane.re[k][l] += (surfaceRe * r - surfaceIm * s) * step
            plane.im[k][l] += (surfaceRe * s + surfaceIm * r) * step
          }
        }
      }
    }
    const R = line.strips.map((_, k) =>
      line.strips.map(
        (_, l) =>
          (impedance.re[k][l] +
            impedance.re[l][k] +
            plane.re[k][l] +
            plane.re[l][k]) /
          2,
      ),
    )
    const L = line.strips.map((_, k) =>
      line.strips.map(
        (_, l) =>
          (impedance.im[k][l] +
            impedance.im[l][k] +
            plane.im[k][l] +
            plane.im[l][k]) /
          2 /
          omega,
      ),
    )
    return { frequency, R, L }
  })
}

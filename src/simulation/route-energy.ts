import { crossoverPoles, type LossPole, skinCrossover } from "../extraction"

/** Sparse energy rows retain only terms integrated from a common physical slice. */
export class RouteEnergy {
  readonly rows: Map<number, number>[]
  /** Share a bound across the five assembled matrices, independent of raw cell count. */
  constructor(
    size: number,
    private readonly budget: { entries: number } = { entries: 0 },
  ) {
    this.rows = Array.from({ length: size }, () => new Map())
  }
  /** Preserve integration order exactly; structural zeros consume no storage. */
  add({
    row,
    column,
    coefficient,
  }: {
    row: number
    column: number
    coefficient: number
  }): void {
    if (coefficient === 0) return
    this.set({
      row,
      column,
      coefficient: (this.rows[row].get(column) ?? 0) + coefficient,
    })
  }
  /** Replace hybrid terms without changing their floating-point evaluation. */
  set({
    row,
    column,
    coefficient,
  }: {
    row: number
    column: number
    coefficient: number
  }): void {
    const entries = this.rows[row]
    if (!Number.isFinite(coefficient))
      throw new Error("Route energy requires finite coefficients")
    if (coefficient === 0) {
      if (entries.delete(column)) this.budget.entries--
      return
    }
    if (!entries.has(column)) {
      if (this.budget.entries >= 500_000)
        throw new Error(
          "Route energy exceeds sparse-memory limit of 500000 matrix entries",
        )
      this.budget.entries++
    }
    entries.set(column, coefficient)
  }
  /** Stable column order preserves the dense deck's text and floating-point summation. */
  entries(i: number): [number, number][] {
    return [...this.rows[i]].sort(([a], [b]) => a - b)
  }
  /** Temporary scaled matrices share the assembled sparsity, without dense allocation. */
  scaled(scale: number): RouteEnergy {
    const result = new RouteEnergy(this.rows.length)
    for (const [i, row] of this.rows.entries())
      for (const [j, coefficient] of row)
        result.rows[i].set(j, coefficient * scale)
    return result
  }
}

/** Stable SPICE precision, bounded far beyond board tolerances. */
function spiceCoefficient(coefficient: number): string {
  return Number(coefficient.toPrecision(12)).toString()
}

/** Coupled series matrix: normalized reciprocal R multiport or mutually coupled inductors. */
export function seriesEnergy({
  lines,
  tag,
  before,
  after,
  matrix,
  kind,
}: {
  lines: string[]
  tag: string
  before: string[]
  after: string[]
  matrix: RouteEnergy
  kind: "R" | "L"
}): void {
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue
    if (kind !== "R") {
      lines.push(
        `L${tag}${i} ${before[i]} ${after[i]} ${spiceCoefficient(matrix.rows[i].get(i) ?? 0)}`,
      )
      continue
    }
    const resistance = matrix.rows[i].get(i) ?? 0
    const terms = matrix
      .entries(i)
      .filter(
        ([j, r]) => j !== i && before[j] !== after[j] && Math.abs(r) >= 1e-20,
      )
    if (!terms.length) {
      lines.push(
        `R${tag}${i} ${before[i]} ${after[i]} ${spiceCoefficient(resistance)}`,
      )
      continue
    }
    // x = sqrt(diag(R)) I; the auxiliary KCL is normalized R x = V/sqrt(diag(R)).
    // Opposite G stamps are lossless gyrators. No tiny CCVS voltage differences or sensor currents.
    const current = `${tag}r${i}`
    const scale = 1 / Math.sqrt(resistance)
    lines.push(
      `R${tag}${i} ${current} 0 1`,
      `G${tag}I${i} ${before[i]} ${after[i]} ${current} 0 ${spiceCoefficient(scale)}`,
      `G${tag}V${i} ${current} 0 ${before[i]} ${after[i]} ${spiceCoefficient(-scale)}`,
    )
    for (const [j, mutual] of terms)
      lines.push(
        `G${tag}${i}_${j} ${current} 0 ${tag}r${j} 0 ${spiceCoefficient(mutual / Math.sqrt(resistance * matrix.rows[j].get(j)!))}`,
      )
  }
  if (kind !== "L") return
  for (let i = 0; i < before.length; i++)
    for (const [j, mutual] of matrix.entries(i)) {
      if (j <= i) continue
      if (
        before[i] !== after[i] &&
        before[j] !== after[j] &&
        Math.abs(mutual) > 1e-24
      )
        lines.push(
          `K${tag}${i}_${j} L${tag}${i} L${tag}${j} ${spiceCoefficient(mutual / Math.sqrt((matrix.rows[i].get(i) ?? 0) * (matrix.rows[j].get(j) ?? 0)))}`,
        )
    }
}

/**
 * Causal skin loss, Z(s) = diag(a_i (z(s + w_i) - z(w_i))) + (S - diag(a)) z(s), with the unit Foster impedance
 * z(s) = sum(skin s / (s + rate)) ~ sqrt(s/pi). Row i's own share a_i is its conductor-wall Wheeler term (`strip`),
 * shifted by its own crossover w_i = pi (R_dc,i / a_i)^2 (`skinCrossover`), so with the series R_dc it gives
 * sqrt(R_dc^2 + a_i^2 s/pi): DC and the conductor's skin loss are not counted twice. The remainder (plane walls and
 * every mutual term) has no DC part and keeps the plain sqrt(f) network. a_i is capped at S_ii - sum_j |S_ij| so
 * the remainder stays diagonally dominant, hence positive semidefinite: both parts are passive and reciprocal.
 * Each a_i stage is a scalar R || L chain from `before` through `stripStages`. Remainder rows without mutual terms
 * are scalar chains through `stages`; coupled rows share one normalized multiport: a series VCCS carries
 * I = x / sqrt(Mii), the auxiliary KCL is sum_j Mn_ij u_j = V / sqrt(Mii), and a grounded unit Foster stage
 * sequence gives u = z(s) x. Returns how many rows had their own share reduced by the cap.
 */
export function skinEnergy({
  lines,
  tag,
  before,
  stripStages,
  stages,
  matrix,
  poles,
  dc,
  strip,
}: {
  lines: string[]
  tag: string
  before: string[]
  stripStages: string[][]
  stages: string[][]
  matrix: RouteEnergy
  poles: LossPole[]
  dc: number[]
  strip: number[]
}): number {
  const after = stages.at(-1)!
  const top = Math.max(...poles.map((pole) => pole.skin))
  const terms = before.map((_, i) =>
    matrix
      .entries(i)
      .filter(
        ([j, coefficient]) => j !== i && Math.abs(coefficient) * top >= 1e-20,
      ),
  )
  const own = before.map((_, i) =>
    Math.max(
      0,
      Math.min(
        strip[i],
        (matrix.rows[i].get(i) ?? 0) -
          terms[i].reduce(
            (sum, [, coefficient]) => sum + Math.abs(coefficient),
            0,
          ),
      ),
    ),
  )
  const rest = own.map(
    (coefficient, i) => (matrix.rows[i].get(i) ?? 0) - coefficient,
  )
  for (const [i, coefficient] of rest.entries()) {
    if (
      coefficient <
      terms[i].reduce((sum, [, mutual]) => sum + Math.abs(mutual), 0) *
        (1 - 1e-12)
    )
      throw new Error(
        "Skin loss remainder must stay diagonally dominant (passive)",
      )
  }
  // A row whose remainder is zero ends its own chain at `after`; one without its own share starts the remainder at `before`.
  const middle = before.map((node, i) => {
    if (!(own[i] > 0)) return node
    if (rest[i] > 0 || terms[i].length) return stripStages.at(-1)![i]
    return after[i]
  })
  const shifted = own.map((coefficient, i) =>
    crossoverPoles(poles, skinCrossover(dc[i], coefficient)),
  )
  for (let p = 0; p < poles.length; p++)
    for (const kind of ["RQ", "LQ"] as const)
      for (let i = 0; i < before.length; i++) {
        if (!(own[i] > 0)) continue
        const resistance = own[i] * shifted[i][p].skin
        let end = middle[i]
        if (p < poles.length - 1) end = stripStages[p][i]
        let start = before[i]
        if (p > 0) start = stripStages[p - 1][i]
        let coefficient = resistance
        if (kind === "LQ") coefficient /= shifted[i][p].rate
        lines.push(
          `${kind[0]}${tag}${kind[1]}${p}${i} ${start} ${end} ${spiceCoefficient(coefficient)}`,
        )
      }
  for (let p = 0; p < poles.length; p++)
    for (const kind of ["RS", "LP"] as const)
      for (let i = 0; i < before.length; i++) {
        if (terms[i].length || (!(rest[i] > 0) && own[i] > 0)) continue
        let coefficient = rest[i] * poles[p].skin
        if (kind === "LP") coefficient /= poles[p].rate
        let start = middle[i]
        if (p > 0) start = stages[p - 1][i]
        lines.push(
          `${kind[0]}${tag}${kind[1]}${p}${i} ${start} ${stages[p][i]} ${spiceCoefficient(coefficient)}`,
        )
      }
  for (let i = 0; i < before.length; i++) {
    if (!terms[i].length) continue
    const self = rest[i]
    const scale = 1 / Math.sqrt(self)
    const x = `${tag}Sx${i}`
    lines.push(
      `G${tag}SI${i} ${middle[i]} ${after[i]} ${x} 0 ${spiceCoefficient(scale)}`,
      `G${tag}SV${i} ${x} 0 ${middle[i]} ${after[i]} ${spiceCoefficient(-scale)}`,
      `G${tag}SF${i} 0 ${tag}Su${i} ${x} 0 1`,
      `G${tag}S${i}_${i} ${x} 0 ${tag}Su${i} 0 1`,
    )
    for (const [j, mutual] of terms[i])
      lines.push(
        `G${tag}S${i}_${j} ${x} 0 ${tag}Su${j} 0 ${spiceCoefficient(mutual / Math.sqrt(self * rest[j]))}`,
      )
    for (const [p, pole] of poles.entries()) {
      let node = `${tag}Su${i}`
      if (p > 0) node = `${tag}F${p - 1}_${i}`
      let next = "0"
      if (p < poles.length - 1) next = `${tag}F${p}_${i}`
      lines.push(
        `R${tag}F${p}_${i} ${node} ${next} ${spiceCoefficient(pole.skin)}`,
        `L${tag}F${p}_${i} ${node} ${next} ${spiceCoefficient(pole.skin / pole.rate)}`,
      )
    }
  }
  return own.filter((coefficient, i) => coefficient < strip[i]).length
}

/** Exact sparse realization for symmetric diagonally dominant energy matrices, including positive mutual entries. */
export function shuntEnergy({
  lines,
  tag,
  nodes,
  matrix,
  rate,
}: {
  lines: string[]
  tag: string
  nodes: string[]
  matrix: RouteEnergy
  rate?: number
}): void {
  const remainder = matrix.rows.map(
    (row, i) =>
      (row.get(i) ?? 0) -
      matrix.entries(i).reduce((total, [j, coefficient]) => {
        if (i === j) return total
        return total + Math.abs(coefficient)
      }, 0),
  )
  if (remainder.some((coefficient) => coefficient < -1e-20)) {
    modalShunt({ lines, tag, nodes, matrix, rate })
    return
  }
  const terms: { a: string; b: string; c: number; sum: boolean }[] = nodes.map(
    (node, i) => ({
      a: node,
      b: "0",
      c: Math.max(0, remainder[i]),
      sum: false,
    }),
  )
  for (let i = 0; i < nodes.length; i++)
    for (const [j, coefficient] of matrix.entries(i))
      if (j > i && Math.abs(coefficient) > 1e-23)
        terms.push({
          a: nodes[i],
          b: nodes[j],
          c: Math.abs(coefficient),
          sum: coefficient > 0,
        })
  for (const [i, term] of terms.entries()) {
    if (term.c <= 1e-23 || (!term.sum && term.a === term.b)) continue
    const name = `${tag}S${i}`
    let reference = term.b
    let node = term.a
    if (term.sum) {
      reference = "0"
      node = `${name}b`
      lines.push(
        `E${name} ${name}a ${term.a} ${term.b} 0 1`,
        `V${name} ${name}a ${name}b 0`,
      )
    }
    let end = reference
    if (rate) end = `${name}c`
    lines.push(`C${name} ${node} ${end} ${spiceCoefficient(term.c)}`)
    if (term.sum) lines.push(`F${name}b ${term.b} 0 V${name} 1`)
    if (rate)
      lines.push(
        `R${name} ${name}c ${reference} ${spiceCoefficient(1 / (rate * term.c))}`,
      )
  }
}

/** LDL energy factors realize a PSD dielectric-loss matrix even when it is not a Maxwell matrix. */
function modalShunt({
  lines,
  tag,
  nodes,
  matrix,
  rate,
}: {
  lines: string[]
  tag: string
  nodes: string[]
  matrix: RouteEnergy
  rate?: number
}): void {
  if (nodes.length ** 2 > 500_000)
    throw new Error(
      "Route energy modal realization exceeds 500000 dense entries",
    )
  const residual = matrix.rows.map((row) =>
    nodes.map((_, j) => row.get(j) ?? 0),
  )
  for (let mode = 0; mode < nodes.length; mode++) {
    const capacitance = residual[mode][mode]
    if (capacitance < -1e-20) throw new Error(`${tag}: negative energy pivot`)
    if (capacitance <= 1e-24) continue
    const weights = residual.map((row, i) => {
      if (i < mode) return 0
      return row[mode] / capacitance
    })
    const expression = weights
      .flatMap((weight, i) => {
        if (nodes[i] === "0" || Math.abs(weight) < 1e-12) return []
        return [`${spiceCoefficient(weight)}*v(${nodes[i]})`]
      })
      .join("+")
    if (expression) {
      const name = `${tag}M${mode}`
      let end = "0"
      if (rate) end = `${name}c`
      lines.push(
        `E${name} ${name}a 0 value={${expression}}`,
        `V${name} ${name}a ${name}b 0`,
        `C${name} ${name}b ${end} ${spiceCoefficient(capacitance)}`,
      )
      if (rate)
        lines.push(
          `R${name} ${name}c 0 ${spiceCoefficient(1 / (rate * capacitance))}`,
        )
      for (const [i, weight] of weights.entries())
        if (nodes[i] !== "0" && Math.abs(weight) >= 1e-12)
          lines.push(
            `F${name}_${i} ${nodes[i]} 0 V${name} ${spiceCoefficient(weight)}`,
          )
    }
    for (let i = mode + 1; i < nodes.length; i++)
      for (let j = mode + 1; j < nodes.length; j++)
        residual[i][j] -= capacitance * weights[i] * weights[j]
  }
}

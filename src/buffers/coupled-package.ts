import type { IbisComponent } from "@tscircuit/ibis-to-spice"
import { type SelectedPackageModel, selectPackageModel } from "./package-matrix"
import { parsePackageModel } from "./package-model"

/** A lumped pi section splits shunt capacitance between its two ends. */
export const PACKAGE_SHUNT_COUNT = 2

/** Reference roles that can share a vendor package bus. */
type PackageRail = "pullup" | "pulldown"

/** POWER and GND can share their package bus with a listed pin. */
export function packageRail(model: string): PackageRail | undefined {
  const name = model.toLowerCase()
  if (name === "power") return "pullup"
  if (name === "gnd") return "pulldown"
  return undefined
}

/** Selected package matrices and aliases for physical pins sharing a package bus. */
export interface CoupledPackageModel extends SelectedPackageModel {
  mergedPins: Record<string, string>
}

/** Log and retain source evidence even when a later admission gate rejects the board. */
export function packageCapacitanceWarnings({
  selected,
  file,
  sourceSha256,
}: {
  selected: SelectedPackageModel | undefined
  file: string
  sourceSha256: string
}): string[] {
  const correction = selected?.capacitanceSignCorrection
  if (!correction) return []
  const model = `package model ${correction.packageModel}`
  const entries = `negated ${correction.negatedEntries} off-diagonal capacitance entries`
  const reason =
    "(uniform positive magnitudes, diagonally dominant rows) before Maxwell sign/passivity validation"
  const warning = `${file} SHA-256 ${sourceSha256}: ${model}: ${entries} ${reason}`
  console.warn(warning)
  return [warning]
}

/** IBIS [Pin Numbers]: unlisted pins use scalar data unless their rail bus is merged. */
export function coupledPackage({
  text,
  component,
  pins,
}: {
  text: string
  component: IbisComponent
  pins: SelectedPackageModel["pins"]
}): CoupledPackageModel | undefined {
  if (component.coupledPackage === undefined) return undefined
  const model = parsePackageModel({ text, name: component.coupledPackage })
  const mergedPins: Record<string, string> = {}
  for (const pin of pins) {
    const physical = component.pins[pin]
    if (!physical)
      throw new Error(
        `${model.name}: selected physical pin ${pin} missing from [Pin]`,
      )
    if (model.pins.includes(pin)) continue
    const role = packageRail(physical.model)
    if (!role) continue
    const bus = component.pinMapping[pin]?.[role]
    if (!bus) continue
    const first = model.pins.find((other) => {
      const sameModel =
        component.pins[other]?.model.toLowerCase() ===
        physical.model.toLowerCase()
      return sameModel && component.pinMapping[other]?.[role] === bus
    })
    if (first) mergedPins[pin] = first
  }
  const selected = [
    ...new Set(
      pins
        .map((pin) => mergedPins[pin] ?? pin)
        .filter((pin) => model.pins.includes(pin)),
    ),
  ]
  return { ...selectPackageModel({ model, pins: selected }), mergedPins }
}

/** Report exact [Pin] self-term differences without substituting scalar package values. */
export function packageComparisons({
  component,
  selected,
}: {
  component: IbisComponent
  selected: SelectedPackageModel
}): string[] {
  const { R, L, C } = selected.selfTerms
  const terms = [
    ["resistance", R],
    ["inductance", L],
    ["capacitance", C],
  ] as const
  const differences: string[] = []
  for (const [i, pin] of selected.pins.entries()) {
    for (const [field, values] of terms) {
      const scalar = component.pins[pin]?.[field]
      const matrix = values[i]
      if (scalar === undefined || scalar === matrix) continue
      const detail = `[Package Model] self term ${matrix} (matrix takes precedence before unused-pin reduction)`
      differences.push(`${pin}: [Pin] ${field} ${scalar}; ${detail}`)
    }
  }
  return differences
}

/**
 * Board-to-die currents define the signs of R and mutual L. Self resistors plus
 * CCVS terms realize the entire R matrix; signed K realizes L. Maxwell C is split
 * equally at board/die ends as one lumped pi section, relative to ideal die ground.
 */
export function coupledPackageElements({
  matrices,
  terminals,
  die,
  ground,
}: {
  matrices: Pick<SelectedPackageModel, "R" | "L" | "C">
  terminals: string[]
  die: string[]
  ground: string
}): string[] {
  const elements: string[] = []
  for (let i = 0; i < terminals.length; i++) {
    let node = `PKGS${i}`
    elements.push(`VPKGS${i} ${terminals[i]} ${node} 0`)
    if (matrices.R[i][i] > 0) {
      elements.push(`RPKG${i} ${node} PKGR${i} ${matrices.R[i][i]}`)
      node = `PKGR${i}`
    }
    for (let j = 0; j < terminals.length; j++) {
      if (i === j || matrices.R[i][j] === 0) continue
      const next = `PKGR${i}_${j}`
      elements.push(
        `HPKG${i}_${j} ${node} ${next} VPKGS${j} ${matrices.R[i][j]}`,
      )
      node = next
    }
    elements.push(`LPKG${i} ${node} ${die[i]} ${matrices.L[i][i]}`)
    const reference = matrices.C[i].reduce(
      (sum, capacitance) => sum + capacitance,
      0,
    )
    if (reference > 0) {
      const half = reference / PACKAGE_SHUNT_COUNT
      elements.push(
        `CPKG${i}a ${terminals[i]} ${ground} ${half}`,
        `CPKG${i}b ${die[i]} ${ground} ${half}`,
      )
    }
    for (let j = i + 1; j < terminals.length; j++) {
      const coupling =
        matrices.L[i][j] / Math.sqrt(matrices.L[i][i] * matrices.L[j][j])
      if (coupling !== 0)
        elements.push(`KPKG${i}_${j} LPKG${i} LPKG${j} ${coupling}`)
      const capacitance = -matrices.C[i][j] / PACKAGE_SHUNT_COUNT
      if (!(capacitance > 0)) continue
      elements.push(
        `CPKG${i}_${j}a ${terminals[i]} ${terminals[j]} ${capacitance}`,
        `CPKG${i}_${j}b ${die[i]} ${die[j]} ${capacitance}`,
      )
    }
  }
  return elements
}

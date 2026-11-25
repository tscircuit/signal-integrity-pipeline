import { ibisNumber } from "@tscircuit/ibis-to-spice"
import type { Matrix } from "../kernel"
import type { PackageSection } from "./package-definition"
import type { PackageModel } from "./package-model"
import { isUnsignedInteger, splitWords } from "./source-tokens"

/** Sparse rows store one column pin and one matrix entry per line. */
const SPARSE_ENTRY_FIELDS = 2

/** Read a finite, specified IBIS matrix entry. */
function matrixNumber({
  token,
  label,
}: {
  token: string
  label: string
}): number {
  try {
    const matrixEntry = ibisNumber(token)
    if (matrixEntry === null) throw new Error("NA")
    return matrixEntry
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Non-finite"))
      throw new Error(`${label}: finite matrix value required: ${token}`, {
        cause,
      })
    throw new Error(`${label}: invalid numeric matrix value ${token}`, {
      cause,
    })
  }
}

/** Expand upper-triangle storage, including the spec's optional circular band. */
export function parseMatrix({
  sections,
  packagePinNames,
  label,
}: {
  sections: PackageSection[]
  packagePinNames: PackageModel["pins"]
  label: string
}): Matrix {
  const format = sections[0].argument.toLowerCase()
  const isSupportedFormat = [
    "full_matrix",
    "banded_matrix",
    "sparse_matrix",
  ].includes(format)
  if (!isSupportedFormat || sections[0].lines.length)
    throw new Error(`${label}: invalid matrix format`)
  const isBanded = format === "banded_matrix"
  const hasBand = sections[1]?.key === "bandwidth"
  let bandwidth = packagePinNames.length - 1
  const hasInvalidBandwidth =
    hasBand &&
    (!isUnsignedInteger(sections[1].argument) || sections[1].lines.length)
  if (isBanded !== hasBand || hasInvalidBandwidth) {
    throw new Error(
      `${label}: [Bandwidth] required only for Banded_matrix before rows`,
    )
  }
  if (hasBand) bandwidth = Number(sections[1].argument)
  if (!Number.isSafeInteger(bandwidth) || bandwidth >= packagePinNames.length)
    throw new Error(`${label}: invalid bandwidth ${bandwidth}`)
  const rows = sections.slice(1 + Number(hasBand))
  const isRowOutOfOrder = rows.some(
    (row, rowIndex) =>
      row.key !== "row" || row.argument !== packagePinNames[rowIndex],
  )
  if (rows.length !== packagePinNames.length || isRowOutOfOrder)
    throw new Error(`${label}: row order must match [Pin Numbers] exactly`)
  let matrixRowTokens: string[][] = []
  if (format !== "sparse_matrix")
    matrixRowTokens = rows.map((row) => row.lines.flatMap(splitWords))
  const isCircularBand =
    isBanded &&
    bandwidth > 0 &&
    matrixRowTokens.every((row) => row.length === bandwidth + 1)
  const maxCircularBandwidth = Math.floor((packagePinNames.length - 1) / 2)
  if (isCircularBand && bandwidth > maxCircularBandwidth) {
    throw new Error(`${label}: circular bandwidth creates redundant entries`)
  }
  const matrix = packagePinNames.map(() => packagePinNames.map(() => 0))
  const indices = new Map(
    packagePinNames.map((pin, rowIndex) => [pin, rowIndex]),
  )
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (format === "sparse_matrix") {
      const seen = new Set<number>()
      for (const line of rows[rowIndex].lines) {
        const tokens = splitWords(line)
        if (tokens.length !== SPARSE_ENTRY_FIELDS) {
          throw new Error(
            `${label} ${packagePinNames[rowIndex]}: each sparse (index, value) pair needs its own line`,
          )
        }
        const columnIndex = indices.get(tokens[0])
        if (columnIndex === undefined)
          throw new Error(`${label}: unknown sparse column pin ${tokens[0]}`)
        if (columnIndex < rowIndex)
          throw new Error(
            `${label}: sparse entries must use the upper triangle in [Pin Numbers] order`,
          )
        if (seen.has(columnIndex))
          throw new Error(`${label}: duplicate sparse column ${tokens[0]}`)
        seen.add(columnIndex)
        const matrixEntry = matrixNumber({ token: tokens[1], label })
        matrix[columnIndex][rowIndex] = matrixEntry
        matrix[rowIndex][columnIndex] = matrixEntry
      }
      continue
    }
    let count = bandwidth + 1
    if (!isCircularBand)
      count = Math.min(count, packagePinNames.length - rowIndex)
    const rowLength = matrixRowTokens[rowIndex].length
    if (rowLength !== count) {
      const detail = `expected ${count} entries, got ${rowLength}`
      throw new Error(
        `${label} ${packagePinNames[rowIndex]}: ${detail}; inconsistent bandwidth or truncated row`,
      )
    }
    for (let diagonalOffset = 0; diagonalOffset < count; diagonalOffset++) {
      const columnIndex = (rowIndex + diagonalOffset) % packagePinNames.length
      const matrixEntry = matrixNumber({
        token: matrixRowTokens[rowIndex][diagonalOffset],
        label,
      })
      matrix[columnIndex][rowIndex] = matrixEntry
      matrix[rowIndex][columnIndex] = matrixEntry
    }
  }
  return matrix
}

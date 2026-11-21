import type { Matrix } from "../extraction"
import {
  asciiLowerCase,
  isDigit,
  isLineBreak,
  isSpace,
  lineEnd,
  splitWords,
  type TextRange,
} from "./text"

/** Horizontal space permitted before and within a package marker. */
const HEADER_SPACING = [" ", "\t"]
/** Carriage return in an IBIS CRLF line ending. */
const CARRIAGE_RETURN = "\r"
/** Line feed separating IBIS package data lines. */
const LINE_FEED = "\n"
/** Default IBIS line-comment marker. */
const DEFAULT_COMMENT = "|"
/** Suffix immediately following the marker in a [Comment Char] declaration. */
const COMMENT_CHAR_SUFFIX = "_char"
/** End offset of a one-character marker and its suffix. */
const COMMENT_CHAR_END = 1 + COMMENT_CHAR_SUFFIX.length
/** IBIS maximum length for a package name, manufacturer, or OEM. */
const PACKAGE_NAME_LIMIT = 40
/** IBIS maximum length for the package description. */
const DESCRIPTION_LIMIT = 59
/** IBIS maximum length for a physical pin name. */
const PACKAGE_PIN_LIMIT = 5
/** Sparse rows store one column pin and one coefficient per line. */
const SPARSE_ENTRY_FIELDS = 2
/** IBIS matrix multipliers, case-sensitive and independent of the trailing unit. */
const MATRIX_SCALES: Record<string, number> = {
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
}

/** IBIS section 7 lumped package data; matrix order is exactly [Pin Numbers]. */
export interface PackageModel {
  name: string
  manufacturer: string
  oem: string
  description: string
  pins: string[]
  R: Matrix
  L: Matrix
  C: Matrix
}

/** A package marker and data lines up to the next marker. */
interface Section {
  key: string
  argument: string
  lines: string[]
}

/** A package marker and its optional argument. */
type SectionHeader = Pick<Section, "key" | "argument">

/** An IBIS package marker, its argument and the offsets of its source line. */
type PackageHeader = SectionHeader & TextRange

/** Scan just the package definition markers and global comment declarations. */
function* packageHeaders(text: string): IterableIterator<PackageHeader> {
  for (let start = 0; start < text.length; ) {
    const lineStart = start
    let end = lineEnd({ text, start })
    start = end + 1
    let open = lineStart
    while (HEADER_SPACING.includes(text[open])) open++
    if (text[open] !== "[") continue
    const header = text.slice(open + 1, end)
    const close = header.indexOf("]")
    if (close < 0) continue
    const key = asciiLowerCase(header.slice(0, close)).replaceAll("_", " ")
    if (
      key !== "define package model" &&
      key !== "end package model" &&
      key !== "comment char"
    )
      continue
    let argument = open + close + 2
    while (HEADER_SPACING.includes(text[argument])) argument++
    // Marker arguments end at CR or LF, even when they contain a Unicode line separator.
    while (
      end < text.length &&
      text[end] !== CARRIAGE_RETURN &&
      text[end] !== LINE_FEED
    )
      end++
    start = end + 1
    yield { key, argument: text.slice(argument, end), start: lineStart, end }
  }
}

/** Read a comment marker followed by the IBIS "_char" suffix. */
function commentCharacter(argument: string): string | undefined {
  const suffix = argument.slice(1, COMMENT_CHAR_END).toLowerCase()
  if (isLineBreak(argument[0]) || suffix !== COMMENT_CHAR_SUFFIX)
    return undefined
  return argument[0]
}

/** Read a selected definition's section header and optional argument. */
function sectionHeader(line: string): SectionHeader | undefined {
  if (!line.startsWith("[")) return undefined
  const close = line.indexOf("]")
  if (close <= 1) return undefined
  const argument = line.slice(close + 1).trimStart()
  if (lineEnd({ text: argument, start: 0 }) !== argument.length)
    return undefined
  const key = line.slice(1, close).toLowerCase().replaceAll("_", " ")
  return { key, argument }
}

/** Check that a count is spelled with one or more ASCII digits. */
function isUnsignedInteger(text: string): boolean {
  if (!text.length) return false
  for (const char of text) if (!isDigit(char)) return false
  return true
}

/** Read the named local definition without splitting a large vendor file into lines. */
export function parsePackageModel({
  text,
  name,
}: {
  text: string
  name: string
}): PackageModel {
  let body: string | undefined
  let active: string | undefined
  let start = 0
  let comment = DEFAULT_COMMENT
  let initialComment = DEFAULT_COMMENT
  // Comment changes outside the selected definition still affect its contents.
  for (const header of packageHeaders(text)) {
    const { key, argument } = header
    if (key === "comment char") {
      const next = commentCharacter(argument)
      const nextCharacter = argument[COMMENT_CHAR_END]
      if (
        next === undefined ||
        (nextCharacter !== undefined && !isSpace(nextCharacter))
      ) {
        throw new Error(`${name}: invalid [Comment Char]`)
      }
      comment = next
      continue
    }
    if (key === "define package model") {
      if (active) throw new Error(`${active}: missing [End Package Model]`)
      active = argument.split(comment)[0].trim()
      if (active === name && body !== undefined)
        throw new Error(`${name}: duplicate package definition`)
      if (active === name) initialComment = comment
      start = header.end
      continue
    }
    if (key === "end package model") {
      if (active === name && argument.split(comment)[0].trim()) {
        throw new Error(`${name}: unexpected data after [End Package Model]`)
      }
      if (active === name) body = text.slice(start, header.start)
      active = undefined
    }
  }
  if (active === name) throw new Error(`${name}: missing [End Package Model]`)
  if (body === undefined) {
    const reason =
      "external .pkg lookup is unsupported; scalar fallback is forbidden"
    throw new Error(
      `${name}: [Define Package Model] missing in IBIS source; ${reason}`,
    )
  }
  if (!name || name.length > PACKAGE_NAME_LIMIT)
    throw new Error(`${name}: invalid package name`)
  const sections: Section[] = []
  comment = initialComment
  const lines = body.split(LINE_FEED)
  for (const [i, raw] of lines.entries()) {
    let lineText = raw
    if (i < lines.length - 1 && raw.endsWith(CARRIAGE_RETURN))
      lineText = raw.slice(0, -1)
    const trimmed = lineText.trimStart()
    const commentHeader = "[comment char]"
    if (
      asciiLowerCase(trimmed.slice(0, commentHeader.length)).replaceAll(
        "_",
        " ",
      ) === commentHeader
    ) {
      const argument = trimmed.slice(commentHeader.length)
      const marker = argument.trimStart()
      const spacing = argument.length - marker.length
      let change = commentCharacter(marker)
      // The last whitespace can itself be the marker when it immediately precedes "_char".
      if (change === undefined && spacing > 0)
        change = commentCharacter(argument.slice(spacing - 1))
      if (change !== undefined) {
        comment = change
        continue
      }
    }
    const line = lineText.split(comment)[0].trim()
    if (!line) continue
    const header = sectionHeader(line)
    if (header?.key === "number of sections") {
      throw new Error(
        `${name}: package sections are unsupported ([Number Of Sections]); scalar fallback is forbidden`,
      )
    }
    if (header) {
      sections.push({ ...header, lines: [] })
      continue
    }
    if (!sections.length)
      throw new Error(`${name}: data before package metadata`)
    sections.at(-1)!.lines.push(line)
  }
  const metadata: Record<string, string> = {}
  const pins: string[] = []
  const matrices: Partial<Pick<PackageModel, "R" | "L" | "C">> = {}
  let count = 0
  let phase: "metadata" | "pins" | "data" | "end" = "metadata"
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    const { key, argument, lines } = section
    if (
      ["manufacturer", "oem", "description", "number of pins"].includes(key)
    ) {
      if (phase !== "metadata" || key in metadata || lines.length) {
        throw new Error(`${name}: invalid or duplicate [${key}]`)
      }
      metadata[key] = argument
      if (key === "number of pins") {
        const pinCount = Number(argument)
        if (
          !isUnsignedInteger(argument) ||
          pinCount < 1 ||
          !Number.isSafeInteger(pinCount)
        ) {
          throw new Error(`${name}: invalid [Number Of Pins]`)
        }
        count = pinCount
        continue
      }
      let maxLength = PACKAGE_NAME_LIMIT
      if (key === "description") maxLength = DESCRIPTION_LIMIT
      if (!argument || argument.length > maxLength)
        throw new Error(`${name}: invalid [${key}]`)
      continue
    }
    if (key === "pin numbers") {
      if (phase !== "metadata" || !count || argument) {
        throw new Error(`${name}: [Number Of Pins] must precede [Pin Numbers]`)
      }
      for (const line of lines) {
        const pinKey = asciiLowerCase(line)
        const sectionSyntax =
          [...line].some(isSpace) || line.includes("=") || line.includes("/")
        if (sectionSyntax || pinKey === "fork" || pinKey === "endfork") {
          throw new Error(
            `${name}: package section syntax is unsupported in [Pin Numbers]`,
          )
        }
        if (line.length > PACKAGE_PIN_LIMIT || pins.includes(line)) {
          throw new Error(`${name}: invalid or duplicate package pin ${line}`)
        }
        pins.push(line)
      }
      if (pins.length !== count) {
        throw new Error(
          `${name}: package pin count ${pins.length} differs from [Number Of Pins] ${count}`,
        )
      }
      phase = "pins"
      continue
    }
    if (key === "model data") {
      if (phase !== "pins" || argument || lines.length)
        throw new Error(`${name}: invalid [Model Data]`)
      phase = "data"
      continue
    }
    if (key === "end model data") {
      if (phase !== "data" || argument || lines.length)
        throw new Error(`${name}: invalid [End Model Data]`)
      phase = "end"
      continue
    }
    const fields: Record<string, "R" | "L" | "C" | undefined> = {
      "resistance matrix": "R",
      "inductance matrix": "L",
      "capacitance matrix": "C",
    }
    const field = fields[key]
    if (!field || phase !== "data" || matrices[field])
      throw new Error(`${name}: unexpected or duplicate [${key}]`)
    let end = i + 1
    while (
      end < sections.length &&
      ["bandwidth", "row"].includes(sections[end].key)
    )
      end++
    matrices[field] = parseMatrix({
      sections: sections.slice(i, end),
      pins,
      label: `${name} [${key}]`,
    })
    i = end - 1
  }
  for (const key of ["manufacturer", "oem", "description"]) {
    if (!(key in metadata))
      throw new Error(`${name}: required [${key.toUpperCase()}] missing`)
  }
  if (phase !== "end") throw new Error(`${name}: missing [End Model Data]`)
  if (!matrices.L || !matrices.C)
    throw new Error(`${name}: required inductance/capacitance matrix missing`)
  return {
    name,
    manufacturer: metadata.manufacturer,
    oem: metadata.oem,
    description: metadata.description,
    pins,
    R: matrices.R ?? pins.map(() => pins.map(() => 0)),
    L: matrices.L,
    C: matrices.C,
  }
}

/** Require a finite standard IBIS number; suffix characters after the scale denote units. */
function matrixNumber({
  token,
  label,
}: {
  token: string
  label: string
}): number {
  let end = 0
  if (token[end] === "+" || token[end] === "-") end++
  const start = end
  while (isDigit(token[end])) end++
  const hasWholeDigits = end > start
  if (token[end] === ".") {
    end++
    while (isDigit(token[end])) end++
  }
  if (!hasWholeDigits && !isDigit(token[end - 1]))
    throw new Error(`${label}: invalid numeric matrix value ${token}`)
  if (token[end] === "e" || token[end] === "E") {
    let exponent = end + 1
    if (token[exponent] === "+" || token[exponent] === "-") exponent++
    // An e without exponent digits can still be part of an alphabetic unit.
    if (isDigit(token[exponent])) {
      while (isDigit(token[exponent])) exponent++
      end = exponent
    }
  }
  const scale = MATRIX_SCALES[token[end]]
  let unit = end
  if (scale !== undefined) unit++
  for (let i = unit; i < token.length; i++) {
    const char = token[i]
    if ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z")) continue
    throw new Error(`${label}: invalid numeric matrix value ${token}`)
  }
  const coefficient = Number(token.slice(0, end)) * (scale ?? 1)
  if (!Number.isFinite(coefficient))
    throw new Error(`${label}: finite matrix value required: ${token}`)
  return coefficient
}

/** Expand upper-triangle storage, including the spec's optional circular band. */
function parseMatrix({
  sections,
  pins,
  label,
}: {
  sections: Section[]
  pins: PackageModel["pins"]
  label: string
}): Matrix {
  const format = sections[0].argument.toLowerCase()
  const supported = ["full_matrix", "banded_matrix", "sparse_matrix"].includes(
    format,
  )
  if (!supported || sections[0].lines.length)
    throw new Error(`${label}: invalid matrix format`)
  const banded = format === "banded_matrix"
  const hasBand = sections[1]?.key === "bandwidth"
  let width = pins.length - 1
  const invalidBandwidth =
    hasBand &&
    (!isUnsignedInteger(sections[1].argument) || sections[1].lines.length)
  if (banded !== hasBand || invalidBandwidth) {
    throw new Error(
      `${label}: [Bandwidth] required only for Banded_matrix before rows`,
    )
  }
  if (hasBand) width = Number(sections[1].argument)
  if (!Number.isSafeInteger(width) || width >= pins.length)
    throw new Error(`${label}: invalid bandwidth ${width}`)
  const rows = sections.slice(1 + Number(hasBand))
  const outOfOrder = rows.some(
    (row, i) => row.key !== "row" || row.argument !== pins[i],
  )
  if (rows.length !== pins.length || outOfOrder)
    throw new Error(`${label}: row order must match [Pin Numbers] exactly`)
  const values = rows.map((row) => row.lines.flatMap(splitWords))
  const circular =
    banded && width > 0 && values.every((row) => row.length === width + 1)
  const maxCircularBandwidth = Math.floor((pins.length - 1) / 2)
  if (circular && width > maxCircularBandwidth) {
    throw new Error(`${label}: circular bandwidth creates redundant entries`)
  }
  const matrix = pins.map(() => pins.map(() => 0))
  const indices = new Map(pins.map((pin, i) => [pin, i]))
  for (let i = 0; i < rows.length; i++) {
    if (format === "sparse_matrix") {
      const seen = new Set<number>()
      for (const line of rows[i].lines) {
        const tokens = splitWords(line)
        if (tokens.length !== SPARSE_ENTRY_FIELDS) {
          throw new Error(
            `${label} ${pins[i]}: each sparse (index, value) pair needs its own line`,
          )
        }
        const j = indices.get(tokens[0])
        if (j === undefined)
          throw new Error(`${label}: unknown sparse column pin ${tokens[0]}`)
        if (j < i)
          throw new Error(
            `${label}: sparse entries must use the upper triangle in [Pin Numbers] order`,
          )
        if (seen.has(j))
          throw new Error(`${label}: duplicate sparse column ${tokens[0]}`)
        seen.add(j)
        const value = matrixNumber({ token: tokens[1], label })
        matrix[j][i] = value
        matrix[i][j] = value
      }
      continue
    }
    let count = width + 1
    if (!circular) count = Math.min(count, pins.length - i)
    const rowLength = values[i].length
    if (rowLength !== count) {
      const detail = `expected ${count} entries, got ${rowLength}`
      throw new Error(
        `${label} ${pins[i]}: ${detail}; inconsistent bandwidth or truncated row`,
      )
    }
    for (let k = 0; k < count; k++) {
      const j = (i + k) % pins.length
      const value = matrixNumber({ token: values[i][k], label })
      matrix[j][i] = value
      matrix[i][j] = value
    }
  }
  return matrix
}

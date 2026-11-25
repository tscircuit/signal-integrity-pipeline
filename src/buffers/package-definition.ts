import {
  isLineBreak,
  isSpace,
  lineEnd,
  type StringOffsets,
} from "./source-tokens"

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
/** A package marker and data lines up to the next marker. */
export interface PackageSection {
  key: string
  argument: string
  lines: string[]
}

/** A package marker and its optional argument. */
type SectionHeader = Pick<PackageSection, "key" | "argument">

/** An IBIS package marker, its argument and the offsets of its source line. */
type PackageHeader = SectionHeader & StringOffsets

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
    const key = header.slice(0, close).toLowerCase().replaceAll("_", " ")
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

/** Source of one local package definition and its inherited comment marker. */
interface DefinitionRange {
  body: string
  initialCommentChar: string
}

/** Read the named local definition without splitting a large vendor file into lines. */
function locatePackageDefinition({
  text,
  name,
}: {
  text: string
  name: string
}): DefinitionRange {
  let body: string | undefined
  let active: string | undefined
  let start = 0
  let currentCommentChar = DEFAULT_COMMENT
  let initialCommentChar = DEFAULT_COMMENT
  // Comment changes outside the selected definition still affect its contents.
  let ibisSource = text
  if (ibisSource.startsWith("\uFEFF")) ibisSource = ibisSource.slice(1)
  for (const header of packageHeaders(ibisSource)) {
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
      currentCommentChar = next
      continue
    }
    if (key === "define package model") {
      if (active) throw new Error(`${active}: missing [End Package Model]`)
      active = argument.split(currentCommentChar)[0].trim()
      if (active === name && body !== undefined)
        throw new Error(`${name}: duplicate package definition`)
      if (active === name) initialCommentChar = currentCommentChar
      start = header.end
      continue
    }
    if (key === "end package model") {
      if (active === name && argument.split(currentCommentChar)[0].trim()) {
        throw new Error(`${name}: unexpected data after [End Package Model]`)
      }
      if (active === name) body = ibisSource.slice(start, header.start)
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
  return { body, initialCommentChar }
}

/** Tokenize a local package definition using its active IBIS comment marker. */
export function readPackageDefinition(input: {
  text: string
  name: string
}): PackageSection[] {
  const { body, initialCommentChar } = locatePackageDefinition(input)
  const { name } = input
  const sections: PackageSection[] = []
  let currentCommentChar = initialCommentChar
  const lines = body.split(LINE_FEED)
  for (const [i, raw] of lines.entries()) {
    let lineText = raw
    if (i < lines.length - 1 && raw.endsWith(CARRIAGE_RETURN))
      lineText = raw.slice(0, -1)
    const trimmed = lineText.trimStart()
    const commentHeader = "[comment char]"
    if (
      trimmed
        .slice(0, commentHeader.length)
        .toLowerCase()
        .replaceAll("_", " ") === commentHeader
    ) {
      const argument = trimmed.slice(commentHeader.length)
      const marker = argument.trimStart()
      const change = commentCharacter(marker)
      if (change !== undefined) {
        currentCommentChar = change
        continue
      }
    }
    const line = lineText.split(currentCommentChar)[0].trim()
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
    sections[sections.length - 1].lines.push(line)
  }
  return sections
}

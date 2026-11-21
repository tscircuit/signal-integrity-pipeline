import type { TextRange } from "../buffers"

const SUBCIRCUIT_DIRECTIVE = ".subckt"

/** JavaScript line feed, carriage return, line separator and paragraph separator. */
const LINE_TERMINATORS = ["\n", "\r", "\u2028", "\u2029"]

/** Read the subcircuit name from a single unindented SPICE declaration. */
export function spiceSubcircuitName(line: string): string | undefined {
  const name = subcircuitNameRange({ text: line, start: 0 })
  return name && line.slice(name.start, name.end)
}

/** A SPICE subcircuit name and its unparsed terminal field. */
type SpiceSubcircuitHeader = [name: string, terminals: string]

/** Find the first unindented subcircuit declaration with a terminal field. */
export function spiceSubcircuitHeader(
  source: string,
): SpiceSubcircuitHeader | null {
  for (let start = 0; start < source.length; start++) {
    if (start > 0 && !isLineBreak(source[start - 1])) continue
    const name = subcircuitNameRange({ text: source, start })
    if (!name || source[name.end]?.trim() !== "") continue
    const terminalStart = skipWhitespace({ text: source, start: name.end })
    if (terminalStart === source.length) {
      // A whitespace-only final field can start after the required separator.
      for (let i = source.length - 1; i > name.end; i--) {
        if (!isLineBreak(source[i]))
          return [source.slice(name.start, name.end), source[i]]
      }
      return null
    }
    let end = terminalStart
    while (end < source.length && !isLineBreak(source[end])) end++
    return [
      source.slice(name.start, name.end),
      source.slice(terminalStart, end),
    ]
  }
  return null
}

/** Split whitespace-delimited SPICE fields, retaining an empty field for blank input. */
export function spiceWords(text: string): string[] {
  const words: string[] = []
  let start = skipWhitespace({ text, start: 0 })
  while (start < text.length) {
    const end = skipWord({ text, start })
    words.push(text.slice(start, end))
    start = skipWhitespace({ text, start: end })
  }
  if (!words.length) return [""]
  return words
}

/** Locate the name after an exact directive and a required whitespace separator. */
function subcircuitNameRange({
  text,
  start,
}: {
  text: string
  start: number
}): TextRange | undefined {
  const directiveEnd = start + SUBCIRCUIT_DIRECTIVE.length
  if (text[directiveEnd]?.trim() !== "") return
  for (let i = 0; i < SUBCIRCUIT_DIRECTIVE.length; i++) {
    const expected = SUBCIRCUIT_DIRECTIVE[i]
    if (
      text[start + i] !== expected &&
      text[start + i] !== expected.toUpperCase()
    )
      return
  }
  const nameStart = skipWhitespace({ text, start: directiveEnd })
  if (nameStart === text.length) return
  return { start: nameStart, end: skipWord({ text, start: nameStart }) }
}

/** Advance across whitespace recognized by JavaScript's string trimming. */
function skipWhitespace({
  text,
  start,
}: {
  text: string
  start: number
}): number {
  while (start < text.length && text[start].trim() === "") start++
  return start
}

/** Advance to the whitespace after a word, or to the end of the string. */
function skipWord({ text, start }: { text: string; start: number }): number {
  while (start < text.length && text[start].trim() !== "") start++
  return start
}

/** Recognize all JavaScript line terminators. */
function isLineBreak(character: string): boolean {
  return LINE_TERMINATORS.includes(character)
}

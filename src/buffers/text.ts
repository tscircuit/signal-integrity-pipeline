/** ECMAScript line terminators: line feed, carriage return, line separator and paragraph separator. */
const LINE_TERMINATORS = ["\n", "\r", "\u2028", "\u2029"]

/** Lowercase ASCII keywords without folding non-ASCII characters into them. */
export function asciiLowerCase(text: string): string {
  let lower = ""
  for (const char of text) {
    if (char >= "A" && char <= "Z") {
      lower += char.toLowerCase()
      continue
    }
    lower += char
  }
  return lower
}

/** Test for one ECMAScript whitespace character. */
export function isSpace(char: string | undefined): boolean {
  return char !== undefined && char.length === 1 && char.trim() === ""
}

/** Test for an ASCII decimal digit. */
export function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9"
}

/** Test for a line terminator in source text. */
export function isLineBreak(char: string): boolean {
  return LINE_TERMINATORS.includes(char)
}

/** Find the next ECMAScript line terminator or the end of the source. */
export function lineEnd({
  text,
  start,
}: {
  text: string
  start: number
}): number {
  let end = start
  while (end < text.length && !isLineBreak(text[end])) end++
  return end
}

/** Start and end offsets in the source text. */
export type TextRange = {
  start: number
  end: number
}

/** Iterate lines with their offsets so callers can replace text without changing separators. */
export function* lineRanges(text: string): IterableIterator<TextRange> {
  for (let start = 0; start < text.length; ) {
    const end = lineEnd({ text, start })
    yield { start, end }
    start = end + 1
  }
}

/** Find the end of a run of non-whitespace characters. */
export function tokenEnd({
  text,
  start,
}: {
  text: string
  start: number
}): number {
  let end = start
  while (end < text.length && !isSpace(text[end])) end++
  return end
}

/** Split on runs of whitespace, retaining empty fields at the ends. */
export function splitWords(text: string): string[] {
  const words: string[] = []
  let start = 0
  while (true) {
    const end = tokenEnd({ text, start })
    words.push(text.slice(start, end))
    if (end === text.length) return words
    start = end + 1
    while (isSpace(text[start])) start++
  }
}

/** The directive and name from a generated SPICE subcircuit header. */
type GeneratedSubcircuitHeader = [directive: ".subckt", name: string]

/** Find the first generated subcircuit header with a name immediately after the directive. */
export function subcircuitHeader(
  source: string,
): GeneratedSubcircuitHeader | null {
  const directive = ".subckt"
  for (const { start, end } of lineRanges(source)) {
    if (!source.startsWith(`${directive} `, start)) continue
    const nameStart = start + directive.length + 1
    if (nameStart >= end) continue
    const nameEnd = tokenEnd({ text: source, start: nameStart })
    if (nameEnd > nameStart)
      return [directive, source.slice(nameStart, nameEnd)]
  }
  return null
}

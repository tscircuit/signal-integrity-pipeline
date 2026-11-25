/** ECMAScript line terminators: line feed, carriage return, line separator and paragraph separator. */
const LINE_TERMINATORS = ["\n", "\r", "\u2028", "\u2029"]

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
export type StringOffsets = {
  start: number
  end: number
}

/** Iterate lines with their offsets so callers can replace text without changing separators. */
export function* lineRanges(text: string): IterableIterator<StringOffsets> {
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

/** Split input into its nonempty whitespace-delimited tokens. */
export function splitWords(text: string): string[] {
  text = text.trim()
  if (!text) return []
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

/** Check that a count is spelled with one or more ASCII digits. */
export function isUnsignedInteger(text: string): boolean {
  if (!text.length) return false
  for (const char of text) if (!isDigit(char)) return false
  return true
}

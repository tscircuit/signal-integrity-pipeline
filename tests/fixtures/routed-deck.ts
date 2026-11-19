/** Split a deck at each JavaScript line terminator. */
function deckLines(deck: string): string[] {
  return deck
    .replaceAll("\r", "\n")
    .replaceAll("\u2028", "\n")
    .replaceAll("\u2029", "\n")
    .split("\n")
}

/** Split at runs of whitespace, preserving empty fields at the ends. */
function whitespaceTokens(text: string): string[] {
  const tokens: string[] = []
  let tokenStart = 0
  let i = 0
  while (i < text.length) {
    if (text[i].trim() !== "") {
      i++
      continue
    }
    tokens.push(text.slice(tokenStart, i))
    do i++
    while (i < text.length && text[i].trim() === "")
    tokenStart = i
  }
  tokens.push(text.slice(tokenStart))
  return tokens
}

/** Read the stop time after the step in the fixture's transient directive. */
export function transientDurationSeconds(deck: string): number {
  const lines = deckLines(deck)
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith(".tran")) continue
    const args = [line.slice(".tran".length), ...lines.slice(i + 1)].join("\n")
    if (args.length === 0 || args[0].trim() !== "") continue
    const [, stop] = whitespaceTokens(args.trim())
    if (stop !== undefined) return Number(stop)
  }
  throw new TypeError("Missing transient stop time")
}

/** Read the first save directive with a nonempty body. */
export function savedVectors(deck: string): string {
  const prefix = ".save "
  const line = deckLines(deck).find(
    (line) => line.startsWith(prefix) && line.length > prefix.length,
  )
  if (line === undefined) throw new TypeError("Missing save directive")
  return line.slice(prefix.length)
}

/** Read unique voltage vector names in order of first appearance. */
export function voltageNames(text: string): string[] {
  const names = new Set<string>()
  let start = text.indexOf("v(")
  while (start >= 0) {
    const nameStart = start + "v(".length
    const end = text.indexOf(")", nameStart)
    if (end < 0) break
    if (end > nameStart) names.add(text.slice(nameStart, end))
    start = text.indexOf("v(", end + 1)
  }
  return [...names]
}

/** Read the time and weight pairs of the first VKU0 piecewise-linear source. */
export function driverWeights(deck: string): number[] {
  const source = "VKU0 "
  const open = "PWL("
  for (const line of deckLines(deck)) {
    if (!line.startsWith(source) || !line.endsWith(")")) continue
    const start = line.lastIndexOf(open, line.length - open.length - 2)
    if (start < source.length) continue
    return whitespaceTokens(line.slice(start + open.length, -1)).map(Number)
  }
  throw new TypeError("Missing VKU0 piecewise-linear source")
}

import { fail } from "./diagnostics"

export interface SpiceVector {
  name: string
  type: string
  values: number[]
}

/** Read real, ASCII ngspice batch vectors without assuming the engine's variable order. */
export function parseSpiceVectors(text: string): SpiceVector[] {
  const header = splitSpiceSection(text, "Values:")
  const count = spiceCount(header[0], "No. Variables:")
  const points = spiceCount(header[0], "No. Points:")
  if (
    header.length !== 2 ||
    !hasRealFlags(header[0]) ||
    !Number.isSafeInteger(count) ||
    count < 2 ||
    !Number.isSafeInteger(points) ||
    points < 2
  )
    fail(
      "waveform",
      "Expected real ASCII ngspice vectors with at least two samples",
    )
  const variables =
    splitSpiceSection(header[0], "Variables:")[1]?.trim().split("\n") ?? []
  const vectors = variables.map((line, i) => {
    const [index, name, type, ...extra] = spiceWords(line)
    if (Number(index) !== i || !name || !type || extra.length)
      fail("waveform", "Invalid ngspice variable declaration")
    return { name: name.toLowerCase(), type, values: [] as number[] }
  })
  if (
    vectors.length !== count ||
    new Set(vectors.map((vector) => vector.name)).size !== count
  )
    fail("waveform", "Invalid ngspice variable count or duplicate name")
  const samples = spiceWords(header[1]).map(Number)
  if (
    samples.length !== points * (count + 1) ||
    samples.some((sample) => !Number.isFinite(sample))
  )
    fail("waveform", "Expected one finite value per ngspice vector and sample")
  for (let sample = 0; sample < points; sample++) {
    const offset = sample * (count + 1)
    if (samples[offset] !== sample)
      fail("waveform", "Invalid ngspice sample index")
    for (let column = 0; column < count; column++)
      vectors[column].values.push(samples[offset + column + 1])
  }
  return vectors
}

/** Format real vectors for protocol fixtures using the native batch transport. */
export function formatSpiceVectors(vectors: SpiceVector[]): string {
  const points = vectors[0]?.values.length ?? 0
  if (
    vectors.length < 2 ||
    points < 2 ||
    vectors.some(
      (vector) =>
        vector.values.length !== points ||
        vector.values.some((sample) => !Number.isFinite(sample)) ||
        !isSpiceWord(vector.name) ||
        !isSpiceWord(vector.type),
    )
  )
    fail("waveform", "Expected complete finite real engine vectors")
  const lines = [
    "Title: Routed transient",
    "Plotname: Transient Analysis",
    "Flags: real",
    `No. Variables: ${vectors.length}`,
    `No. Points: ${points}`,
    "Variables:",
    ...vectors.map((vector, i) => `\t${i}\t${vector.name}\t${vector.type}`),
    "Values:",
  ]
  for (let sample = 0; sample < points; sample++)
    lines.push(
      `${sample}\t${vectors.map((vector) => vector.values[sample]).join("\n\t")}`,
    )
  return lines.join("\n") + "\n"
}

/** Difference receiver and reference vectors at the actual adaptive sample times. */
export function spiceProbeRows(
  text: string,
  probes: readonly { signalNode: string; referenceNode: string }[],
): number[][] {
  const vectors = new Map(
    parseSpiceVectors(text).map((vector) => [vector.name, vector.values]),
  )
  const times = vectors.get("time")
  if (!times) return fail("waveform", "Missing ngspice time vector")
  if (times.some((time, i) => i > 0 && time < times[i - 1]))
    fail("waveform", "Expected increasing actual solver timestamps")
  return times.flatMap((time, sample) => {
    if (sample < times.length - 1 && time === times[sample + 1]) return []
    return [
      [
        time,
        ...probes.map(
          ({ signalNode, referenceNode }) =>
            nodeVoltage({ name: signalNode, sample }, vectors) -
            nodeVoltage({ name: referenceNode, sample }, vectors),
        ),
      ],
    ]
  })
}

/** Ground is implicit; every other requested node must be present. */
function nodeVoltage(
  { name, sample }: { name: string; sample: number },
  vectors: ReadonlyMap<SpiceVector["name"], number[]>,
): number {
  if (name === "0") return 0
  const voltage = vectors.get(`v(${name.toLowerCase()})`)
  if (!voltage) return fail("waveform", `Missing ngspice vector v(${name})`)
  return voltage[sample]
}

/** Split on standalone section labels, leaving any line break after each label in the next section. */
function splitSpiceSection(text: string, label: string): string[] {
  const sections: string[] = []
  let sectionStart = 0
  for (const start of spiceFieldStarts(text, label)) {
    const end = whitespaceLineEnd(text, start + label.length)
    if (end === undefined) continue
    sections.push(text.slice(sectionStart, start))
    sectionStart = end
  }
  sections.push(text.slice(sectionStart))
  return sections
}

/** Read the first line for this count that contains only an unsigned integer and whitespace. */
function spiceCount(text: string, label: string): number {
  for (const field of spiceFieldStarts(text, label)) {
    const start = skipWhitespace(text, field + label.length)
    let end = start
    while (text[end] >= "0" && text[end] <= "9") end++
    if (end > start && whitespaceLineEnd(text, end) !== undefined)
      return Number(text.slice(start, end))
  }
  return NaN
}

/** Check for a real-valued ASCII waveform header. */
function hasRealFlags(text: string): boolean {
  for (const field of spiceFieldStarts(text, "Flags:")) {
    const start = skipWhitespace(text, field + "Flags:".length)
    if (
      text.startsWith("real", start) &&
      whitespaceLineEnd(text, start + "real".length) !== undefined
    )
      return true
  }
  return false
}

/** Find exact labels at the start of any JavaScript line. */
function* spiceFieldStarts(text: string, label: string): Generator<number> {
  for (
    let start = text.indexOf(label);
    start !== -1;
    start = text.indexOf(label, start + label.length)
  ) {
    if (start === 0 || isLineBreak(text[start - 1])) yield start
  }
}

/** Find the last line boundary in the whitespace after a field. */
function whitespaceLineEnd(text: string, start: number): number | undefined {
  let end: number | undefined
  for (let i = start; i < text.length; i++) {
    if (text[i].trim() !== "") return end
    if (isLineBreak(text[i])) end = i
  }
  return text.length
}

/** Recognize all JavaScript line terminators. */
function isLineBreak(character: string): boolean {
  return (
    character === "\n" ||
    character === "\r" ||
    character === "\u2028" ||
    character === "\u2029"
  )
}

/** Read whitespace-delimited fields, returning one empty field for blank input. */
function spiceWords(text: string): string[] {
  const words: string[] = []
  let start = skipWhitespace(text, 0)
  while (start < text.length) {
    const end = skipWord(text, start)
    words.push(text.slice(start, end))
    start = skipWhitespace(text, end)
  }
  return words.length ? words : [""]
}

/** Check that a name or type contains exactly one nonempty field. */
function isSpiceWord(text: string): boolean {
  return text.length > 0 && skipWord(text, 0) === text.length
}

/** Advance to the next non-whitespace character or the end of the string. */
function skipWhitespace(text: string, start: number): number {
  while (start < text.length && text[start].trim() === "") start++
  return start
}

/** Advance past a field's non-whitespace characters. */
function skipWord(text: string, start: number): number {
  while (start < text.length && text[start].trim() !== "") start++
  return start
}

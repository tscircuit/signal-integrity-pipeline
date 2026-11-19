import { fail } from "./diagnostics"

/** One ngspice variable, with its raw name, declared kind and ordered samples. */
export interface SpiceVector {
  name: string
  type: string
  values: number[]
}

/** The ngspice nodes whose voltage difference is sampled by one probe. */
interface SpiceProbeNodes {
  signalNode: string
  referenceNode: string
}

/** An adaptive sample's time in seconds followed by voltages in probe order. */
export type SpiceProbeRow = [timestampSeconds: number, ...voltages: number[]]

/** JavaScript line boundaries accepted when searching for ASCII raw file section labels. */
const LINE_ENDINGS = "\n\r\u2028\u2029"

/** Tab separates fields and line feed separates lines in an ASCII raw file. */
const FIELD_SEPARATOR = "\t"
const LINE_SEPARATOR = "\n"

/** A usable waveform contains a time vector, a voltage vector and at least two samples. */
const MINIMUM_WAVEFORM_SIZE = 2

/** SPICE uses node zero as the implicit ground reference. */
const GROUND_NODE = "0"

/** Read real, ASCII ngspice batch vectors without assuming the engine's variable order. */
export function parseSpiceVectors(text: string): SpiceVector[] {
  const header = splitSpiceSection({ text, label: "Values:" })
  const count = spiceCount({ text: header[0], label: "No. Variables:" })
  const points = spiceCount({ text: header[0], label: "No. Points:" })
  if (
    header.length !== 2 ||
    !hasRealFlags(header[0]) ||
    !isWaveformSize(count) ||
    !isWaveformSize(points)
  ) {
    fail(
      "waveform",
      "Expected real ASCII ngspice vectors with at least two samples",
    )
  }
  const variableSection = splitSpiceSection({
    text: header[0],
    label: "Variables:",
  })[1]
  const declarations = variableSection?.trim().split(LINE_SEPARATOR) ?? []
  const vectors = declarations.map((line, position) =>
    spiceVariable({ line, position }),
  )
  const uniqueNames = new Set(vectors.map((vector) => vector.name))
  if (vectors.length !== count || uniqueNames.size !== count) {
    fail("waveform", "Invalid ngspice variable count or duplicate name")
  }
  const samples = spiceWords(header[1]).map(Number)
  const fieldsPerPoint = count + 1
  if (
    samples.length !== points * fieldsPerPoint ||
    samples.some((sample) => !Number.isFinite(sample))
  ) {
    fail("waveform", "Expected one finite value per ngspice vector and sample")
  }
  for (let sample = 0; sample < points; sample++) {
    const offset = sample * fieldsPerPoint
    if (samples[offset] !== sample)
      fail("waveform", "Invalid ngspice sample index")
    const firstValue = offset + 1
    for (let column = 0; column < count; column++) {
      vectors[column].values.push(samples[firstValue + column])
    }
  }
  return vectors
}

/** Check that the raw header declares a usable integer count. */
function isWaveformSize(count: number): boolean {
  return Number.isSafeInteger(count) && count >= MINIMUM_WAVEFORM_SIZE
}

/** Read one ordered variable declaration before its samples are available. */
function spiceVariable({
  line,
  position,
}: {
  line: string
  position: number
}): SpiceVector {
  const [index, name, type, ...extra] = spiceWords(line)
  if (Number(index) !== position || !name || !type || extra.length) {
    fail("waveform", "Invalid ngspice variable declaration")
  }
  return { name: name.toLowerCase(), type, values: [] }
}

/** Check that a fixture vector has a usable declaration and a finite value at each sample. */
function isCompleteVector({
  vector,
  points,
}: {
  vector: SpiceVector
  points: number
}): boolean {
  if (vector.values.length !== points) return false
  if (vector.values.some((sample) => !Number.isFinite(sample))) return false
  return isSpiceWord(vector.name) && isSpiceWord(vector.type)
}

/** Format real vectors for protocol fixtures using the native batch transport. */
export function formatSpiceVectors(vectors: SpiceVector[]): string {
  const points = vectors[0]?.values.length ?? 0
  if (
    vectors.length < MINIMUM_WAVEFORM_SIZE ||
    points < MINIMUM_WAVEFORM_SIZE ||
    vectors.some((vector) => !isCompleteVector({ vector, points }))
  ) {
    fail("waveform", "Expected complete finite real engine vectors")
  }
  const lines = [
    "Title: Routed transient",
    "Plotname: Transient Analysis",
    "Flags: real",
    `No. Variables: ${vectors.length}`,
    `No. Points: ${points}`,
    "Variables:",
    ...vectors.map(
      (vector, i) =>
        `${FIELD_SEPARATOR}${[i, vector.name, vector.type].join(FIELD_SEPARATOR)}`,
    ),
    "Values:",
  ]
  for (let sample = 0; sample < points; sample++) {
    const values = vectors.map((vector) => vector.values[sample])
    const separator = `${LINE_SEPARATOR}${FIELD_SEPARATOR}`
    lines.push(`${sample}${FIELD_SEPARATOR}${values.join(separator)}`)
  }
  return `${lines.join(LINE_SEPARATOR)}${LINE_SEPARATOR}`
}

/** Difference receiver and reference vectors at the actual adaptive sample times. */
export function spiceProbeRows({
  text,
  probes,
}: {
  text: string
  probes: readonly SpiceProbeNodes[]
}): SpiceProbeRow[] {
  const vectors = new Map(
    parseSpiceVectors(text).map((vector) => [vector.name, vector.values]),
  )
  const timesSeconds = vectors.get("time")
  if (!timesSeconds) return fail("waveform", "Missing ngspice time vector")
  if (
    timesSeconds.some(
      (timeSeconds, i) => i > 0 && timeSeconds < timesSeconds[i - 1],
    )
  ) {
    fail("waveform", "Expected increasing actual solver timestamps")
  }
  const rows: SpiceProbeRow[] = []
  for (const [sample, timeSeconds] of timesSeconds.entries()) {
    if (
      sample < timesSeconds.length - 1 &&
      timeSeconds === timesSeconds[sample + 1]
    )
      continue
    const voltages = probes.map(({ signalNode, referenceNode }) => {
      const signalVoltage = nodeVoltage({ name: signalNode, sample, vectors })
      const referenceVoltage = nodeVoltage({
        name: referenceNode,
        sample,
        vectors,
      })
      return signalVoltage - referenceVoltage
    })
    rows.push([timeSeconds, ...voltages])
  }
  return rows
}

/** Ground is implicit; every other requested node must be present. */
function nodeVoltage({
  name,
  sample,
  vectors,
}: {
  name: string
  sample: number
  vectors: ReadonlyMap<SpiceVector["name"], number[]>
}): number {
  if (name === GROUND_NODE) return 0
  const voltage = vectors.get(`v(${name.toLowerCase()})`)
  if (!voltage) return fail("waveform", `Missing ngspice vector v(${name})`)
  return voltage[sample]
}

/** Split on standalone section labels, leaving any line break after each label in the next section. */
function splitSpiceSection({
  text,
  label,
}: {
  text: string
  label: string
}): string[] {
  const sections: string[] = []
  let sectionStart = 0
  for (const start of spiceFieldStarts({ text, label })) {
    const end = whitespaceLineEnd({ text, start: start + label.length })
    if (end === undefined) continue
    sections.push(text.slice(sectionStart, start))
    sectionStart = end
  }
  sections.push(text.slice(sectionStart))
  return sections
}

/** Read the first line for this count that contains only an unsigned integer and whitespace. */
function spiceCount({ text, label }: { text: string; label: string }): number {
  for (const field of spiceFieldStarts({ text, label })) {
    const start = skipWhitespace({ text, start: field + label.length })
    let end = start
    while (text[end] >= "0" && text[end] <= "9") end++
    if (end > start && whitespaceLineEnd({ text, start: end }) !== undefined)
      return Number(text.slice(start, end))
  }
  return NaN
}

/** Check for a real-valued ASCII waveform header. */
function hasRealFlags(text: string): boolean {
  for (const field of spiceFieldStarts({ text, label: "Flags:" })) {
    const start = skipWhitespace({ text, start: field + "Flags:".length })
    if (!text.startsWith("real", start)) continue
    if (whitespaceLineEnd({ text, start: start + "real".length }) !== undefined)
      return true
  }
  return false
}

/** Find exact labels at the start of any JavaScript line. */
function* spiceFieldStarts({
  text,
  label,
}: {
  text: string
  label: string
}): Generator<number> {
  for (
    let start = text.indexOf(label);
    start !== -1;
    start = text.indexOf(label, start + label.length)
  ) {
    if (start === 0 || isLineBreak(text[start - 1])) yield start
  }
}

/** Find the last line boundary in the whitespace after a field. */
function whitespaceLineEnd({
  text,
  start,
}: {
  text: string
  start: number
}): number | undefined {
  let end: number | undefined
  for (let i = start; i < text.length; i++) {
    if (text[i].trim() !== "") return end
    if (isLineBreak(text[i])) end = i
  }
  return text.length
}

/** Recognize all JavaScript line terminators. */
function isLineBreak(character: string): boolean {
  return LINE_ENDINGS.includes(character)
}

/** Read whitespace-delimited fields, returning one empty field for blank input. */
function spiceWords(text: string): string[] {
  const words: string[] = []
  let start = skipWhitespace({ text, start: 0 })
  while (start < text.length) {
    const end = skipWord({ text, start })
    words.push(text.slice(start, end))
    start = skipWhitespace({ text, start: end })
  }
  if (words.length) return words
  return [""]
}

/** Check that a name or type contains exactly one nonempty field. */
function isSpiceWord(text: string): boolean {
  return text.length > 0 && skipWord({ text, start: 0 }) === text.length
}

/** Advance to the next non-whitespace character or the end of the string. */
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

/** Advance past a field's non-whitespace characters. */
function skipWord({ text, start }: { text: string; start: number }): number {
  while (start < text.length && text[start].trim() !== "") start++
  return start
}

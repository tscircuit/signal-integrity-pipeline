import type {
  IbisBuffer,
  IbisCorner,
  IbisDocument,
  LogicalSchedule,
} from "@tscircuit/ibis-to-spice"
import {
  convertIbisBuffer,
  convertIbisModelToSpice,
  cornerValue,
  IbisError,
  ibisTimeSeconds,
  interpolate,
  logicalBitSchedule,
  sourceHash,
  spiceNumber,
} from "@tscircuit/ibis-to-spice"
import { lineRanges, subcircuitHeader, tokenEnd } from "./text"
import type { ModelRunDefinition, PackagedComponent } from "./types"

/** Time in seconds and measured pullup and pulldown coefficients. */
type Weights = Array<[seconds: number, pullup: number, pulldown: number]>

/** Samples from a fixture at one selected IBIS corner. */
type FixtureVoltageTable = Array<[seconds: number, voltage: number]>

/** Time in seconds and a single measured switching coefficient. */
type CoefficientSample = [seconds: number, coefficient: number]

/** Measured transition direction in an IBIS waveform. */
type Edge = IbisBuffer["waveforms"][number]["kind"]

/** The extraction and settlement checks use the same two measured fixtures. */
const WAVEFORM_FIXTURE_COUNT = 2
/** A tail is settled within 1% of the fixture swing and within 0.01 in switching coefficient. */
const SETTLED_TOLERANCE = 0.01
/** The first 20 characters of the content hash identify an IBIS subcircuit. */
const SUBCIRCUIT_HASH_LENGTH = 20

const SETTLED_TAIL_WARNING = [
  "IBIS inactive tails truncated only after all remaining two-fixture voltages and switching coefficients settle",
  "within the recorded 1% tolerances; retained endpoint coefficients are held, without time compression or",
  "initial-delay removal",
].join(" ")

/** Evidence for fixture voltage settlement over the discarded portion of an edge. */
interface SwitchingFixture {
  resistanceOhms: number
  voltage: number
  toleranceVolts: number
  maxDeviationVolts: number
}

/** Evidence for a bounded inactive-tail approximation, never an active-edge interruption. */
export interface SwitchingTail {
  physicalPin: string
  model: string
  edge: Edge
  originalDurationSeconds: number
  retainedDurationSeconds: number
  coefficientTolerance: number
  maxCoefficientDeviation: number
  maxCoefficientHoldError: number
  fixtures: SwitchingFixture[]
}

/** Earliest sample whose entire suffix stays in tolerance; a late excursion resets the window. */
function settledIndex({
  deviations,
  limit,
}: {
  deviations: number[]
  limit: number
}): number {
  let index = deviations.length
  while (index > 0 && deviations[index - 1] <= limit) index--
  return index
}

/** Measure a fixture's largest remaining deviation from its final voltage. */
function fixtureDeviation({
  table,
  timeSeconds,
}: {
  table: FixtureVoltageTable
  timeSeconds: number
}): number {
  const final = table.at(-1)![1]
  const remaining = table
    .filter(([sampleTime]) => sampleTime >= timeSeconds)
    .map(([, voltage]) => voltage)
  const voltages = [interpolate(table, timeSeconds), ...remaining]
  return Math.max(...voltages.map((voltage) => Math.abs(voltage - final)))
}

/** Check original two-fixture voltages AND the extracted coefficients, including the complete tail. */
function settledTail({
  buffer,
  corner,
  edge,
  weights,
  physicalPin,
}: {
  buffer: IbisBuffer
  corner: IbisCorner
  edge: Edge
  weights: Weights
  physicalPin: string
}): SwitchingTail | undefined {
  const pullup = Number(edge === "rising")
  const pulldown = 1 - pullup
  const deviations = weights.map((row) =>
    Math.max(Math.abs(row[1] - pullup), Math.abs(row[2] - pulldown)),
  )
  const index = settledIndex({ deviations, limit: SETTLED_TOLERANCE })
  if (index === weights.length) return undefined
  let timeSeconds = weights[index][0]
  const waves = buffer.waveforms
    .filter((wave) => wave.kind === edge)
    .slice(0, WAVEFORM_FIXTURE_COUNT)
  const tables = waves.map((wave) =>
    wave.data.map(([seconds, ...voltages]): FixtureVoltageTable[number] => [
      seconds,
      cornerValue(voltages, corner, edge),
    ]),
  )
  for (const table of tables) {
    const final = table.at(-1)![1]
    const limit = SETTLED_TOLERANCE * Math.abs(final - table[0][1])
    const start = settledIndex({
      deviations: table.map((row) => Math.abs(row[1] - final)),
      limit,
    })
    timeSeconds = Math.max(timeSeconds, table[start][0])
  }
  const cut = weights.findIndex((row) => row[0] >= timeSeconds)
  if (cut < 0) return undefined
  const [retainedDurationSeconds, heldPullup, heldPulldown] = weights[cut]
  const holdErrors = weights
    .slice(cut)
    .flatMap(([, pullup, pulldown]) => [
      Math.abs(pullup - heldPullup),
      Math.abs(pulldown - heldPulldown),
    ])
  return {
    physicalPin,
    model: buffer.name,
    edge,
    originalDurationSeconds: weights.at(-1)![0],
    retainedDurationSeconds,
    coefficientTolerance: SETTLED_TOLERANCE,
    maxCoefficientDeviation: Math.max(...deviations.slice(cut)),
    maxCoefficientHoldError: Math.max(...holdErrors),
    fixtures: tables.map((table, i) => ({
      resistanceOhms: waves[i].resistance,
      voltage: cornerValue(waves[i].fixtureVoltage, corner, "V_fixture"),
      toleranceVolts:
        SETTLED_TOLERANCE * Math.abs(table.at(-1)![1] - table[0][1]),
      maxDeviationVolts: fixtureDeviation({
        table,
        timeSeconds: retainedDurationSeconds,
      }),
    })),
  }
}

/** Stitch full measured coefficient edges, discarding only proven settled tails when necessary. */
function scheduleWeights({
  buffer,
  corner,
  schedule,
  physicalPin,
  document,
  tails,
}: {
  buffer: IbisBuffer
  corner: IbisCorner
  schedule: LogicalSchedule
  physicalPin: string
  document: IbisDocument
  tails: SwitchingTail[]
}): Weights {
  const pullup = Number(Boolean(schedule.initialState))
  const pulldown = 1 - pullup
  const samples: Weights = [[0, pullup, pulldown]]
  if (!schedule.transitions.length)
    return [...samples, [schedule.duration, pullup, pulldown]]
  const converted = convertIbisBuffer(document, buffer.name, {
    corner,
    mode: "output",
  })
  for (const [i, transition] of schedule.transitions.entries()) {
    let edge: Edge = "falling"
    if (transition.state) edge = "rising"
    let weights = converted.weights![edge]
    if (weights[0][0] !== 0) {
      throw new IbisError(
        "unsupported_waveforms",
        "Switching waveform must start at zero relative time",
      )
    }
    const nextSeconds = schedule.transitions[i + 1]?.time
    if (
      nextSeconds !== undefined &&
      transition.time + weights.at(-1)![0] >= nextSeconds
    ) {
      const tail = settledTail({
        buffer,
        corner,
        edge,
        weights,
        physicalPin,
      })
      if (
        !tail ||
        transition.time + tail.retainedDurationSeconds > nextSeconds
      ) {
        const detail =
          "has not settled before the next edge (1% fixture swing and 0.01 switching-coefficient tolerances)"
        const reason = "active-transition interruption is unsupported"
        throw new IbisError(
          "overlapping_edges",
          `${buffer.name}: actual ${edge} transition ${detail}; ${reason}`,
        )
      }
      weights = weights.filter((row) => row[0] <= tail.retainedDurationSeconds)
      if (
        !tails.some(
          (entry) => entry.physicalPin === physicalPin && entry.edge === edge,
        )
      )
        tails.push(tail)
    }
    // Each edge starts from the held coefficients. A femtosecond jump to the table's
    // first row (extraction residue up to the settled tolerance) forces sub-fs steps.
    const last = samples.at(-1)!
    weights = [[0, last[1], last[2]], ...weights.slice(1)]
    for (const [seconds, ku, kd] of weights) {
      const absoluteSeconds = transition.time + seconds
      if (absoluteSeconds > schedule.duration) break
      if (absoluteSeconds === samples.at(-1)![0]) samples.pop()
      samples.push([absoluteSeconds, ku, kd])
    }
    if (transition.time + weights.at(-1)![0] > schedule.duration) {
      const timeSeconds = schedule.duration - transition.time
      const pullup = weights.map(
        ([seconds, ku]): CoefficientSample => [seconds, ku],
      )
      const pulldown = weights.map(
        ([seconds, , kd]): CoefficientSample => [seconds, kd],
      )
      samples.push([
        schedule.duration,
        interpolate(pullup, timeSeconds),
        interpolate(pulldown, timeSeconds),
      ])
    }
  }
  const last = samples.at(-1)!
  if (last[0] < schedule.duration)
    samples.push([schedule.duration, last[1], last[2]])
  return samples
}

/** Read the two nodes of a generated PWL voltage line. */
function pwlNodes({
  line,
  voltage,
}: {
  line: string
  voltage: string
}): string | undefined {
  if (!line.startsWith(`${voltage} `) || !line.endsWith(")")) return undefined
  const first = voltage.length + 1
  const firstEnd = tokenEnd({ text: line, start: first })
  if (firstEnd === first || line[firstEnd] !== " ") return undefined
  const second = firstEnd + 1
  const secondEnd = tokenEnd({ text: line, start: second })
  if (secondEnd === second || !line.startsWith(" PWL(", secondEnd))
    return undefined
  return line.slice(first, secondEnd)
}

/** Replace the first matching generated source, retaining its nodes and line separator. */
function replacePwl({
  source,
  voltage,
  samples,
  column,
}: {
  source: string
  voltage: string
  samples: Weights
  column: 1 | 2
}): string {
  for (const { start, end } of lineRanges(source)) {
    const nodes = pwlNodes({ line: source.slice(start, end), voltage })
    if (nodes === undefined) continue
    const points = samples
      .map((row) => `${spiceNumber(row[0])} ${spiceNumber(row[column])}`)
      .join(" ")
    return `${source.slice(0, start)}${voltage} ${nodes} PWL(${points})${source.slice(end)}`
  }
  return source
}

/** Use upstream pin/reference and die-buffer conversion; the pipeline owns explicit edge scheduling. */
export function convertSwitching({
  bytes,
  input,
  document,
}: {
  bytes: Uint8Array
  input: ModelRunDefinition
  document: IbisDocument
}): PackagedComponent {
  // Validate the ORIGINAL pattern before building the steady electrical skeleton.
  for (const stimulus of Object.values(input.run.stimuli))
    logicalBitSchedule(stimulus, input.run.duration)
  const stimuli = Object.fromEntries(
    Object.entries(input.run.stimuli).map(([port, stimulus]) => {
      const pattern = {
        ...stimulus.pattern,
        bits: String(stimulus.initialState),
        repeat: true,
      }
      return [port, { ...stimulus, pattern }]
    }),
  )
  const definition = { ...input.definition, packagePolicy: "omit" } as const
  const converted: PackagedComponent = convertIbisModelToSpice(
    bytes,
    definition,
    { ...input.run, stimuli },
  )
  const tails: SwitchingTail[] = []
  const schedules = converted.metadata.pins.map((pin, i) => {
    const stimulus = input.run.stimuli[pin.port]
    if (!stimulus) return undefined
    const buffer = document.getBuffer(pin.model)
    const schedule = logicalBitSchedule(
      stimulus,
      input.run.duration,
      buffer.polarity,
    )
    pin.stimulusHash = schedule.sha256
    const samples = scheduleWeights({
      buffer,
      corner: input.definition.corner,
      schedule,
      physicalPin: pin.physicalPin,
      document,
      tails,
    })
    for (const [label, column] of [
      ["KU", 1],
      ["KD", 2],
    ] as const) {
      converted.source = replacePwl({
        source: converted.source,
        voltage: `V${label}${i}`,
        samples,
        column,
      })
    }
    return schedule
  })
  // Match upstream identity for untouched schedules, including source and true stimulus hashes.
  const original = subcircuitHeader(converted.source)![1]
  const identity = JSON.stringify([
    converted.metadata,
    schedules,
    ibisTimeSeconds(input.run.duration),
  ])
  const name = `IBIS_${sourceHash(identity).slice(0, SUBCIRCUIT_HASH_LENGTH)}`
  converted.source = converted.source.replaceAll(original, name)
  if (tails.length) {
    converted.metadata.switchingTails = tails
    converted.warnings = [...converted.warnings, SETTLED_TAIL_WARNING]
  }
  return converted
}

/* eslint-disable local/max-file-lines -- Keep transient, eye and envelope drawings on one shared scale. */
import type { GraphicsObject, Point, Viewbox } from "graphics-debug"
import {
  type RoutedSections,
  routeBoardDrawing,
  routeCanvas,
  routeFailure,
  routeFrame,
  routeHue,
  routeMarks,
  routePane,
  routePortPoint,
  routeText,
  routeTones,
  routeView,
  type SourcePortId,
  withRouteDrawing,
} from "../board"
import type { IbisSources, TextRange } from "../buffers"
import type { Snapshot } from "../kernel"
import { sha256 } from "../kernel"
import type { RouteBuffer, RoutedCapture } from "./routed-types"

/** A board port and its transient waveform label. */
export interface WaveformProbe {
  name: string
  sourcePortId: SourcePortId
  /** The probe sits at the driver: a dot on the board and a thinner dashed curve drawn underneath. */
  near: boolean
}

/** The receivers' input thresholds (IBIS Vinl and Vinh), drawn as the band a signal must cross cleanly. */
export interface ReceiverThreshold {
  low: number
  high: number
}

/** Inputs for drawing a pending, completed or failed transient. */
export interface WaveformState {
  board?: RoutedSections
  probes: readonly WaveformProbe[]
  capture?: RoutedCapture
  durationSeconds: number
  threshold?: ReceiverThreshold
  running: boolean
  error?: string
}

const thresholdUnits = new Map([
  ["k", 1e3],
  ["K", 1e3],
  ["m", 1e-3],
  ["M", 1e-3],
  ["u", 1e-6],
  ["U", 1e-6],
  ["n", 1e-9],
  ["N", 1e-9],
  ["p", 1e-12],
  ["P", 1e-12],
])

/** Advance over contiguous ASCII digits. */
function digitEnd({ text, start }: { text: string; start: number }): number {
  let end = start
  while (text[end] >= "0" && text[end] <= "9") end++
  return end
}

/** Typical value of an IBIS number with an optional SI suffix (`0.8`, `800m`, `1.2V`). */
function ibisNumber(text: string): number | undefined {
  let start = 0
  if (text[0] === "+" || text[0] === "-") start = 1
  let end = digitEnd({ text, start })
  if (text[end] === ".") {
    const fraction = digitEnd({ text, start: end + 1 })
    if (fraction > end + 1) end = fraction
  }
  if (end === start) return undefined
  if (text[end] === "e" || text[end] === "E") {
    let exponent = end + 1
    if (text[exponent] === "+" || text[exponent] === "-") exponent++
    const exponentEnd = digitEnd({ text, start: exponent })
    if (exponentEnd > exponent) end = exponentEnd
  }
  return Number(text.slice(0, end)) * (thresholdUnits.get(text[end]) ?? 1)
}

/** Advance over contiguous whitespace. */
function skipWhitespace({
  text,
  start,
}: {
  text: string
  start: number
}): number {
  let end = start
  while (end < text.length && text[end].trim() === "") end++
  return end
}

/** Find the end of a model name or a typical-value token. */
function tokenEnd({ text, start }: { text: string; start: number }): number {
  let end = start
  while (end < text.length && text[end].trim() !== "") end++
  return end
}

/** JavaScript line boundaries accepted in IBIS source text. */
const LINE_ENDINGS = "\r\n\u2028\u2029"

/** Find a case-insensitive keyword at a line start, allowing leading whitespace. */
function ibisLinePrefix({
  text,
  prefix,
  from,
}: {
  text: string
  prefix: string
  from: number
}): TextRange | undefined {
  for (let start = from; start < text.length; start++) {
    if (start > 0 && !LINE_ENDINGS.includes(text[start - 1])) continue
    const keyword = skipWhitespace({ text, start })
    const end = keyword + prefix.length
    if (text.slice(keyword, end).toLowerCase() === prefix) return { start, end }
    start = keyword
  }
  return undefined
}

/** Find the first section whose initial token is the bound model name. */
function thresholdModel({
  text,
  model,
}: {
  text: string
  model: string
}): string | undefined {
  const name = model.toLowerCase()
  let start = 0
  while (true) {
    const header = ibisLinePrefix({ text, prefix: "[model]", from: start })
    const end = header?.start ?? text.length
    if (
      text
        .slice(
          start,
          Math.min(
            end,
            tokenEnd({
              text,
              start,
            }),
          ),
        )
        .toLowerCase() === name
    )
      return text.slice(start, end)
    if (!header) return undefined
    start = skipWhitespace({ text, start: header.end })
  }
}

/** One keyword's typical value inside this model's section. */
function modelThreshold({
  section,
  name,
}: {
  section: string | undefined
  name: "Vinl" | "Vinh"
}): number | undefined {
  if (section === undefined) return undefined
  const keyword = ibisLinePrefix({
    text: section,
    prefix: name.toLowerCase(),
    from: 0,
  })
  if (!keyword) return undefined
  let start = skipWhitespace({ text: section, start: keyword.end })
  if (section[start] === "=")
    start = skipWhitespace({ text: section, start: start + 1 })
  return ibisNumber(section.slice(start, tokenEnd({ text: section, start })))
}

/**
 * Vinl/Vinh of the bound single-ended receiver models, widened across receivers; none for differential
 * receivers or models without them.
 */
export function receiverThreshold({
  ibisSources,
  models,
  receivers,
}: {
  ibisSources: IbisSources
  models: readonly Snapshot<RouteBuffer>[]
  receivers: ReadonlySet<SourcePortId>
}): ReceiverThreshold | undefined {
  const texts = Object.values(ibisSources).map((bytes) => {
    if (typeof bytes === "string") return bytes
    return new TextDecoder().decode(bytes)
  })
  const found: ReceiverThreshold[] = []
  for (const model of models) {
    const text = texts.find(
      (candidate) => sha256(candidate) === model.metadata.sourceSha256,
    )
    for (const pin of model.metadata.pins) {
      if (!receivers.has(pin.port)) continue
      if (pin.modelType.toLowerCase().includes("diff")) return undefined
      if (text === undefined) continue
      const section = thresholdModel({ text, model: pin.model })
      const low = modelThreshold({ section, name: "Vinl" })
      const high = modelThreshold({ section, name: "Vinh" })
      if (low !== undefined && high !== undefined) found.push({ low, high })
    }
  }
  if (!found.length) return undefined
  return {
    low: Math.min(...found.map((entry) => entry.low)),
    high: Math.max(...found.map((entry) => entry.high)),
  }
}

/** A round step (1, 2 or 5 × 10ⁿ) giving about `count` intervals. */
export function roundStep({
  range,
  count,
}: {
  range: number
  count: number
}): number {
  const raw = Math.max(range, 1e-30) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10]
    .map((factor) => factor * power)
    .find((step) => step >= raw)!
}

/** A plot-axis tick's numeric position and display label. */
type AxisTick = {
  value: number
  text: string
}

/** Ticks as integer multiples of a round step, so labels never show floating-point noise. */
export function roundTicks({
  low,
  high,
  count,
}: {
  low: number
  high: number
  count: number
}): AxisTick[] {
  const step = roundStep({ range: high - low, count })
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const first = Math.ceil(low / step - 1e-9)
  return Array.from(
    { length: Math.max(1, Math.floor(high / step + 1e-9) - first + 1) },
    (_, i) => {
      const tick = (first + i) * step
      if (first + i === 0) return { value: tick, text: (0).toFixed(digits) }
      return { value: tick, text: tick.toFixed(digits) }
    },
  )
}

/** Per-bucket extremes in time order, so a narrow overshoot survives the reduction to about `limit` buckets. */
function waveformSampleIndices({
  times,
  values,
  from,
  limit,
}: {
  times: readonly number[]
  values: readonly number[]
  from: number
  limit: number
}): number[] {
  const bucket = Math.max(1, Math.ceil((times.length - from) / limit))
  const kept: number[] = []
  for (let start = from; start < times.length; start += bucket) {
    const end = Math.min(times.length, start + bucket)
    let low = start
    let high = start
    for (let j = start + 1; j < end; j++) {
      if (values[j] < values[low]) low = j
      if (values[j] > values[high]) high = j
    }
    kept.push(
      ...[...new Set([start, low, high, end - 1])].sort((a, b) => a - b),
    )
  }
  return kept
}

/** The minimum and maximum voltages among a set of samples. */
type SampleExtent = [low: number, high: number]

/** Lowest and highest of many samples, without spreading them onto the call stack. */
function extent(levels: readonly number[]): SampleExtent {
  let low = Infinity
  let high = -Infinity
  for (const level of levels) {
    low = Math.min(low, level)
    high = Math.max(high, level)
  }
  return [low, high]
}

/** How far a curve leaves the common 5–95 % band, above or below. */
function excursion({
  levels,
  low,
  high,
}: {
  levels: readonly number[]
  low: number
  high: number
}): number {
  const [least, most] = extent(levels)
  return Math.max(most - high, low - least)
}

/** Eye folding starts once a capture has enough bit periods to show repeated transitions. */
const MINIMUM_EYE_INTERVALS = 8

/** Every eye fold spans two bit periods. */
const EYE_INTERVALS = 2

/** Show an envelope above this number of far-end traces. */
const MAX_INDIVIDUAL_PROBES = 6

/** One vertical envelope band for each time bucket. */
const ENVELOPE_COLUMNS = 300

/** Trim quiet time until a probe moves by 5% of the full swing, retaining some lead-in. */
const ACTIVE_SWING_FRACTION = 0.05
const TRANSIENT_LEAD_IN_FRACTION = 0.08

/** A visible voltage curve and its index in the requested probe order. */
interface WaveformSeries {
  entry: RoutedCapture["probes"][number]
  index: number
}

/** The shared sample and axis inputs for drawing all waveforms in the pane. */
interface WaveformCurveContext {
  coordinates: PlotCoordinates
  times: readonly number[]
  from: number
  eye: boolean
}

/**
 * Probe marks on the board and a waveform pane beside it.
 * Long captures fold into a two-unit-interval eye. Short captures start just before the first activity.
 * Above six far-end probes, draw their envelope and the largest excursion. A band shows IBIS input thresholds.
 * Amber hatching means ngspice is running.
 */
export function routeWaveformDrawing(state: WaveformState): GraphicsObject {
  const { board, probes, capture, durationSeconds } = state
  const view =
    board && routeView({ circuit: board.circuitJson, scope: board.scope })
  const frame =
    view ??
    routeFrame({
      minX: 0,
      maxX: 100,
      minY: 0,
      maxY: 40,
    })
  let drawing = waveformCanvas({ frame, board })
  const styles = probes.map((probe, i) => {
    const net = view?.ports.get(probe.sourcePortId)
    return {
      color: net?.color ?? routeHue({ hue: 195 + (i * 360) / probes.length }),
      label: net?.label ?? probe.name,
      unitIntervalSeconds: net?.unitIntervalSeconds,
      differential: Boolean(net?.differential),
    }
  })
  // Single-ended input thresholds mean nothing for a differential receiver.
  let threshold: ReceiverThreshold | undefined
  if (probes.some((probe, i) => !probe.near && !styles[i].differential))
    threshold = state.threshold
  if (board) {
    const marks = probes.flatMap((probe, i) => {
      const point = routePortPoint({
        circuit: board.circuitJson,
        sourcePortId: probe.sourcePortId,
      })
      if (!point) return []
      return [
        {
          point,
          color: styles[i].color,
          driver: probe.near,
          label: styles[i].label,
        },
      ]
    })
    drawing.polygons!.push(...routeMarks({ marks, unit: frame.unit }))
  }
  const pane = frame.pane
  let paneColor: string | undefined
  let topPadding = 4
  if (state.error) {
    paneColor = routeTones.failure
    topPadding = 14
  }
  drawing = withRouteDrawing({
    drawing: drawing,
    overlay: routePane({ box: pane, edge: paneColor }),
  })
  if (state.error)
    drawing.texts!.push(...routeFailure({ box: pane, message: state.error }))
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const plot: Viewbox = {
    minX: pane.minX + unit * 10,
    maxX: pane.maxX - unit * 3,
    minY: pane.minY + unit * 8,
    maxY: pane.maxY - unit * topPadding,
  }
  const size = unit * 2.6
  const times = capture?.timestampsSeconds ?? []
  const series =
    capture?.probes.map((entry) => ({
      entry,
      index: probes.findIndex((probe) => probe.name === entry.name),
    })) ?? []
  const far = series.filter(({ index }) => !probes[index]?.near)
  const unitIntervalSeconds = Math.min(
    ...styles.map((style) => style.unitIntervalSeconds || Infinity),
  )
  const eye =
    Boolean(capture) &&
    Number.isFinite(unitIntervalSeconds) &&
    durationSeconds / unitIntervalSeconds >= MINIMUM_EYE_INTERVALS
  const [least, most] = extent(
    series.flatMap(({ entry }) => entry.voltageLevels),
  )
  const swing = most - least
  const activeSwing = swing * ACTIVE_SWING_FRACTION
  const active = times.findIndex((_, j) =>
    series.some(({ entry }) => {
      const delta = entry.voltageLevels[j] - entry.voltageLevels[0]
      return Math.abs(delta) > activeSwing
    }),
  )
  let start = 0
  if (!eye && active >= 0) {
    const activeTime = times[active]
    const leadIn = (durationSeconds - activeTime) * TRANSIENT_LEAD_IN_FRACTION
    start = Math.max(0, activeTime - leadIn)
  }
  const from = Math.max(
    0,
    times.findIndex((time) => time >= start),
  )
  const shown = series.flatMap(({ entry }) => entry.voltageLevels.slice(from))
  // Before samples exist, the axes span ground to well above any threshold so the band reads as a band.
  const bounds = [...shown]
  if (threshold) bounds.push(threshold.low, threshold.high)
  if (!shown.length) bounds.push(0, Math.max(1, (threshold?.high ?? 0) * 1.8))
  const [lowest, highest] = extent(bounds)
  const levels = roundTicks({ low: lowest, high: highest, count: 5 })
  const bottom = Math.min(levels[0].value, lowest)
  const top = Math.max(levels.at(-1)!.value, highest, bottom + 1e-9)
  const coordinates = {
    plot,
    bottom,
    top,
    origin: start,
    timeSpan: Math.max(durationSeconds - start, 1e-30),
  }
  if (eye) {
    coordinates.origin = 0
    coordinates.timeSpan = EYE_INTERVALS
  }
  for (const level of levels) {
    let color: string = routeTones.paneEdge
    if (level.value === 0) color = routeTones.quiet
    const y = plotY({ coordinates, voltage: level.value })
    drawing.lines!.push({
      points: [
        { x: plot.minX, y },
        { x: plot.maxX, y },
      ],
      strokeColor: color,
      strokeWidth: unit * 0.15,
    })
    drawing.texts!.push(
      routeText({
        x: plot.minX - unit * 1.2,
        y,
        text: `${level.text} V`,
        color: routeTones.quiet,
        size,
        anchor: "center_right",
      }),
    )
  }
  drawing = withRouteDrawing({
    drawing: drawing,
    overlay: drawTimeAxis({
      coordinates,
      eye,
      start,
      durationSeconds,
      unit,
      size,
    }),
  })
  if (threshold) {
    const low = plotY({ coordinates, voltage: threshold.low })
    const high = plotY({ coordinates, voltage: threshold.high })
    drawing.lines!.push({
      points: [
        { x: plot.minX, y: (low + high) / 2 },
        { x: plot.maxX, y: (low + high) / 2 },
      ],
      strokeColor: routeTones.threshold,
      strokeWidth: high - low,
      zIndex: -0.5,
      label: "receiver threshold",
    })
  }
  if (state.running && !capture)
    for (let i = 1; i < 16; i++) {
      const offset = ((plot.maxX - plot.minX) * i) / 16
      drawing.lines!.push({
        points: [
          {
            x: plot.minX + offset,
            y: plot.minY,
          },
          {
            x: Math.min(
              plot.maxX,
              plot.minX + offset + (plot.maxY - plot.minY) * 0.5,
            ),
            y: plot.maxY,
          },
        ],
        strokeColor: "rgba(251, 191, 36, 0.3)",
        strokeWidth: unit * 0.5,
      })
    }
  if (!capture) return drawing
  const curveContext = {
    coordinates,
    times,
    from,
    eye,
  }
  if (far.length > MAX_INDIVIDUAL_PROBES && !eye) {
    drawing.lines!.push(
      ...drawEnvelope({
        input: { series: far, curveContext, unit, start, durationSeconds },
      }),
    )
    const worst = greatestExcursion({ series: far, from })
    const style = styles[worst.index] ?? styles[0]
    const runs = waveformCurve({
      curveLevels: worst.entry.voltageLevels,
      periodSeconds: unitIntervalSeconds,
      context: curveContext,
    })
    for (const points of runs) {
      drawing.lines!.push({
        points,
        strokeColor: style.color,
        strokeWidth: unit * 0.35,
        label: style.label,
        layer: "waveform",
      })
    }
    return drawing
  }
  const nearFirst = [...series].sort(
    (a, b) => Number(!probes[a.index]?.near) - Number(!probes[b.index]?.near),
  )
  for (const { entry, index } of nearFirst) {
    const style = styles[index] ?? {
      color: routeHue({ hue: 0 }),
      label: entry.name,
      unitIntervalSeconds: undefined,
      differential: false,
    }
    let width = 0.3
    let strokeDash: string | undefined
    if (probes[index]?.near) {
      width = 0.18
      strokeDash = "6 4"
    }
    const periodSeconds = style.unitIntervalSeconds ?? unitIntervalSeconds
    const runs = waveformCurve({
      curveLevels: entry.voltageLevels,
      periodSeconds,
      context: curveContext,
    })
    for (const points of runs) {
      drawing.lines!.push({
        points,
        strokeColor: style.color,
        strokeWidth: unit * width,
        strokeDash,
        label: style.label,
        layer: "waveform",
      })
    }
  }
  return drawing
}

interface EnvelopeInput {
  series: WaveformSeries[]
  curveContext: WaveformCurveContext
  unit: number
  start: number
  durationSeconds: number
}

/** Shade the full far-end voltage range in each time bucket. */
function drawEnvelope({
  input,
}: {
  input: EnvelopeInput
}): NonNullable<GraphicsObject["lines"]> {
  const drawing = routeCanvas()
  const { series, curveContext, unit, start, durationSeconds } = input
  const { coordinates, times, from } = curveContext
  const { plot, timeSpan } = coordinates
  const duration = durationSeconds - start
  const columns: SampleExtent[] = Array.from(
    { length: ENVELOPE_COLUMNS },
    () => [Infinity, -Infinity],
  )
  for (let j = from; j < times.length; j++) {
    const fraction = (times[j] - start) / timeSpan
    const index = Math.min(
      ENVELOPE_COLUMNS - 1,
      Math.floor(fraction * ENVELOPE_COLUMNS),
    )
    const column = columns[index]
    for (const { entry } of series) {
      const level = entry.voltageLevels[j]
      column[0] = Math.min(column[0], level)
      column[1] = Math.max(column[1], level)
    }
  }
  const columnWidth = (plot.maxX - plot.minX) / ENVELOPE_COLUMNS
  for (const [i, [low, high]] of columns.entries()) {
    if (!(high >= low)) continue
    const time = start + ((i + 0.5) * duration) / ENVELOPE_COLUMNS
    const x = plotX({ coordinates, time })
    drawing.lines!.push({
      points: [
        { x, y: plotY({ coordinates, voltage: low }) },
        { x, y: plotY({ coordinates, voltage: high }) + unit * 0.05 },
      ],
      strokeColor: routeTones.envelope,
      strokeWidth: columnWidth * 1.05,
      zIndex: -0.4,
    })
  }
  return drawing.lines!
}

/** Use the middle 90% of samples as the common voltage band. */
const LOWER_BAND_QUANTILE = 0.05
const UPPER_BAND_QUANTILE = 0.95

/** Find the far-end waveform that moves farthest outside the common voltage band. */
function greatestExcursion({
  series,
  from,
}: {
  series: WaveformSeries[]
  from: number
}): WaveformSeries {
  const levels = series.flatMap(({ entry }) => entry.voltageLevels.slice(from))
  levels.sort((a, b) => a - b)
  const low = levels[Math.floor(levels.length * LOWER_BAND_QUANTILE)]
  const high = levels[Math.floor(levels.length * UPPER_BAND_QUANTILE)]
  return series.reduce((worst, candidate) => {
    const candidateExcursion = excursion({
      levels: candidate.entry.voltageLevels.slice(from),
      low,
      high,
    })
    const worstExcursion = excursion({
      levels: worst.entry.voltageLevels.slice(from),
      low,
      high,
    })
    if (candidateExcursion > worstExcursion) return candidate
    return worst
  })
}

interface PlotCoordinates {
  plot: Viewbox
  bottom: number
  top: number
  origin: number
  timeSpan: number
}

/** Use the board drawing when present, otherwise the default frame. */
function waveformCanvas({
  frame,
  board,
}: {
  frame: ReturnType<typeof routeFrame>
  board?: RoutedSections
}): GraphicsObject {
  if (board)
    return routeBoardDrawing({ circuit: board.circuitJson, scope: board.scope })
  return routeCanvas(frame)
}

/** Convert seconds, or unit intervals in an eye, to the plot. */
function plotX({
  coordinates,
  time,
}: {
  coordinates: PlotCoordinates
  time: number
}): number {
  const { plot, origin, timeSpan } = coordinates
  return plot.minX + ((time - origin) / timeSpan) * (plot.maxX - plot.minX)
}

/** Convert volts to the plot, bottom to top. */
function plotY({
  coordinates,
  voltage,
}: {
  coordinates: PlotCoordinates
  voltage: number
}): number {
  const { plot, bottom, top } = coordinates
  return (
    plot.minY + ((voltage - bottom) / (top - bottom)) * (plot.maxY - plot.minY)
  )
}

/** Draw the time scale for a transient capture or an eye spanning two unit intervals. */
function drawTimeAxis({
  coordinates,
  eye,
  start,
  durationSeconds,
  unit,
  size,
}: {
  coordinates: PlotCoordinates
  eye: boolean
  start: number
  durationSeconds: number
  unit: number
  size: number
}): GraphicsObject {
  const drawing = routeCanvas()
  const { plot } = coordinates
  if (eye) {
    for (const tick of [0, 1, EYE_INTERVALS]) {
      const x = plotX({ coordinates, time: tick })
      drawing.lines!.push({
        points: [
          { x, y: plot.minY },
          { x, y: plot.maxY },
        ],
        strokeColor: routeTones.paneEdge,
        strokeWidth: unit * 0.15,
      })
      let label = "0"
      if (tick) label = `${tick} UI`
      drawing.texts!.push(
        routeText({
          x,
          y: plot.minY - unit * 1.5,
          text: label,
          color: routeTones.quiet,
          size,
          anchor: "top_center",
        }),
      )
    }
    return drawing
  }
  const [scale, name] = (
    [
      [1, "s"],
      [1e3, "ms"],
      [1e6, "µs"],
      [1e9, "ns"],
      [1e12, "ps"],
    ] as const
  ).find(([scale]) => durationSeconds * scale >= 1) ?? [1e12, "ps"]
  for (const tick of roundTicks({
    low: start * scale,
    high: durationSeconds * scale,
    count: 5,
  })) {
    drawing.lines!.push({
      points: [
        {
          x: plotX({ coordinates, time: tick.value / scale }),
          y: plot.minY,
        },
        {
          x: plotX({ coordinates, time: tick.value / scale }),
          y: plot.minY - unit,
        },
      ],
      strokeColor: routeTones.quiet,
      strokeWidth: unit * 0.15,
    })
    drawing.texts!.push(
      routeText({
        x: plotX({ coordinates, time: tick.value / scale }),
        y: plot.minY - unit * 1.5,
        text: `${tick.text} ${name}`,
        color: routeTones.quiet,
        size,
        anchor: "top_center",
      }),
    )
  }
  return drawing
}

/** Points in one continuous segment of a plotted waveform. */
type WaveformRun = Point[]

/** Cap display sampling while keeping more detail in the multi-run eye. */
const TRANSIENT_SAMPLE_BUCKETS = 700
const EYE_SAMPLE_BUCKETS = 2500

/** One probe's curve, cut at every fold of the eye. */
function waveformCurve({
  curveLevels,
  periodSeconds,
  context,
}: {
  curveLevels: readonly number[]
  periodSeconds: number
  context: WaveformCurveContext
}): WaveformRun[] {
  const { coordinates, times, from, eye } = context
  if (!eye) {
    const indices = waveformSampleIndices({
      times,
      values: curveLevels,
      from,
      limit: TRANSIENT_SAMPLE_BUCKETS,
    })
    return [
      indices.map((j) => ({
        x: plotX({ coordinates, time: times[j] }),
        y: plotY({ coordinates, voltage: curveLevels[j] }),
      })),
    ]
  }
  const middle = extent(curveLevels).reduce((a, b) => a + b) / 2
  const crossing = curveLevels.findIndex(
    (level, j) => j > 0 && (curveLevels[j - 1] - middle) * (level - middle) < 0,
  )
  let origin = 0
  if (crossing > 0) origin = times[crossing]
  origin -= periodSeconds / 2
  const runs: WaveformRun[] = [[]]
  let last = -1
  const indices = waveformSampleIndices({
    times,
    values: curveLevels,
    from: 0,
    limit: EYE_SAMPLE_BUCKETS,
  })
  for (const j of indices) {
    const interval = (times[j] - origin) / periodSeconds
    const phase = ((interval % EYE_INTERVALS) + EYE_INTERVALS) % EYE_INTERVALS
    if (phase < last) runs.push([])
    runs.at(-1)!.push({
      x: plotX({ coordinates, time: phase }),
      y: plotY({ coordinates, voltage: curveLevels[j] }),
    })
    last = phase
  }
  return runs.filter((run) => run.length > 1)
}

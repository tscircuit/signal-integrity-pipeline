import type { GraphicsObject, Point, Viewbox } from 'graphics-debug'
import { routeBoardDrawing, routeCanvas, routeFailure, routeFrame, routeHue, routeMarks, routePane, routePortPoint, routeText, routeTones, routeView, type RoutedSections } from '../board'
import type { IbisSources } from '../buffers'
import { sha256 } from '../kernel'
import type { RoutedCapture, RouteBuffer } from './routed-types'

export interface WaveformProbe {
  name: string
  sourcePortId: string
  /** The probe sits at the driver: a dot on the board and a thinner dashed curve drawn underneath. */
  near: boolean
}

/** The receivers' input thresholds (IBIS Vinl and Vinh), drawn as the band a signal must cross cleanly. */
export interface ReceiverThreshold {
  low: number
  high: number
}

export interface WaveformState {
  board?: RoutedSections
  probes: readonly WaveformProbe[]
  capture?: RoutedCapture
  durationSeconds: number
  threshold?: ReceiverThreshold
  running: boolean
  error?: string
}

/** Typical value of an IBIS number with an optional SI suffix (`0.8`, `800m`, `1.2V`). */
function ibisNumber(text: string): number | undefined {
  const match = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)([kmunp]?)/i.exec(text)
  if (!match) return undefined
  return Number(match[1]) * ({ k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }[match[2].toLowerCase()] ?? 1)
}

/** One keyword's typical value inside this model's section. */
function modelThreshold(section: string | undefined, name: 'Vinl' | 'Vinh'): number | undefined {
  return ibisNumber(new RegExp(`^\\s*${name}\\s*=?\\s*(\\S+)`, 'im').exec(section ?? '')?.[1] ?? '')
}

/** Vinl/Vinh of the bound single-ended receiver models, widened across receivers; none for differential receivers or models without them. */
export function receiverThreshold({ ibisSources, models, receivers }: { ibisSources: IbisSources; models: readonly RouteBuffer[]; receivers: ReadonlySet<string> }): ReceiverThreshold | undefined {
  const texts = Object.values(ibisSources).map((bytes) => {
    if (typeof bytes === 'string') return bytes
    return new TextDecoder().decode(bytes)
  })
  const found: ReceiverThreshold[] = []
  for (const model of models) {
    const text = texts.find((candidate) => sha256(candidate) === model.metadata.sourceSha256)
    for (const pin of model.metadata.pins) {
      if (!receivers.has(pin.port)) continue
      if (/diff/i.test(pin.modelType)) return undefined
      const section = text?.split(/^\s*\[Model\]\s*/im).find((part) => part.split(/\s/)[0].toLowerCase() === pin.model.toLowerCase())
      const low = modelThreshold(section, 'Vinl')
      const high = modelThreshold(section, 'Vinh')
      if (low !== undefined && high !== undefined) found.push({ low, high })
    }
  }
  if (!found.length) return undefined
  return { low: Math.min(...found.map((entry) => entry.low)), high: Math.max(...found.map((entry) => entry.high)) }
}

/** A round step (1, 2 or 5 × 10ⁿ) giving about `count` intervals. */
export function roundStep(range: number, count: number): number {
  const raw = Math.max(range, 1e-30) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((factor) => factor * power).find((step) => step >= raw)!
}

/** Ticks as integer multiples of a round step, so labels never show floating-point noise. */
export function roundTicks({ low, high, count }: { low: number; high: number; count: number }): { value: number; text: string }[] {
  const step = roundStep(high - low, count)
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const first = Math.ceil(low / step - 1e-9)
  return Array.from({ length: Math.max(1, Math.floor(high / step + 1e-9) - first + 1) }, (_, i) => {
    const tick = (first + i) * step
    if (first + i === 0) return { value: tick, text: (0).toFixed(digits) }
    return { value: tick, text: tick.toFixed(digits) }
  })
}

/** Per-bucket extremes in time order, so a narrow overshoot survives the reduction to about `limit` buckets. */
function waveformSampleIndices({ times, values, from, limit }: { times: readonly number[]; values: readonly number[]; from: number; limit: number }): number[] {
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
    kept.push(...[...new Set([start, low, high, end - 1])].sort((a, b) => a - b))
  }
  return kept
}

/** Lowest and highest of many samples, without spreading them onto the call stack. */
function extent(levels: readonly number[]): [number, number] {
  let low = Infinity
  let high = -Infinity
  for (const level of levels) {
    low = Math.min(low, level)
    high = Math.max(high, level)
  }
  return [low, high]
}

/** How far a curve leaves the common 5–95 % band, above or below. */
function excursion({ levels, low, high }: { levels: readonly number[]; low: number; high: number }): number {
  const [least, most] = extent(levels)
  return Math.max(most - high, low - least)
}

/**
 * Probe marks on the board and a waveform pane beside it.
 * Long captures fold into a two-UI eye; short ones start just before the first activity. Above six far-end probes,
 * an envelope and the worst curve replace the rainbow. IBIS receiver thresholds are a band; amber hatching means ngspice is running.
 */
export function routeWaveformDrawing(state: WaveformState): GraphicsObject {
  const { board, probes, capture, durationSeconds } = state
  const view = board && routeView(board.circuitJson, board.scope)
  const frame = view ?? routeFrame({ minX: 0, maxX: 100, minY: 0, maxY: 40 })
  const drawing = waveformCanvas(frame, board)
  const styles = probes.map((probe, i) => {
    const net = view?.ports.get(probe.sourcePortId)
    return { color: net?.color ?? routeHue({ hue: 195 + (i * 360) / probes.length }), label: net?.label ?? probe.name, unitInterval: net?.unitInterval, differential: Boolean(net?.differential) }
  })
  // Single-ended input thresholds mean nothing for a differential receiver.
  let threshold: ReceiverThreshold | undefined
  if (probes.some((probe, i) => !probe.near && !styles[i].differential)) threshold = state.threshold
  if (board) {
    const marks = probes.flatMap((probe, i) => {
      const point = routePortPoint(board.circuitJson, probe.sourcePortId)
      if (!point) return []
      return [{ point, color: styles[i].color, driver: probe.near, label: styles[i].label }]
    })
    routeMarks({ drawing, marks, unit: frame.unit })
  }
  const pane = frame.pane
  let paneColor: string | undefined
  let topPadding = 4
  if (state.error) {
    paneColor = routeTones.failure
    topPadding = 14
  }
  routePane({ drawing, box: pane, edge: paneColor })
  if (state.error) routeFailure({ drawing, box: pane, message: state.error })
  const unit = Math.max(pane.maxX - pane.minX, pane.maxY - pane.minY) / 100
  const plot: Viewbox = { minX: pane.minX + unit * 10, maxX: pane.maxX - unit * 3, minY: pane.minY + unit * 8, maxY: pane.maxY - unit * topPadding }
  const size = unit * 2.6
  const times = capture?.timestampsSeconds ?? []
  const series = capture?.probes.map((entry) => ({ entry, index: probes.findIndex((probe) => probe.name === entry.name) })) ?? []
  const far = series.filter(({ index }) => !probes[index]?.near)
  const unitInterval = Math.min(...styles.map(style => style.unitInterval || Infinity))
  const eye = Boolean(capture) && Number.isFinite(unitInterval) && durationSeconds / unitInterval >= 8
  const [least, most] = extent(series.flatMap(({ entry }) => entry.voltageLevels))
  const swing = most - least
  const active = times.findIndex((_, j) => series.some(({ entry }) => Math.abs(entry.voltageLevels[j] - entry.voltageLevels[0]) > swing * 0.05))
  let start = 0
  if (!eye && active >= 0) start = Math.max(0, times[active] - (durationSeconds - times[active]) * 0.08)
  const from = Math.max(0, times.findIndex((time) => time >= start))
  const shown = series.flatMap(({ entry }) => entry.voltageLevels.slice(from))
  // Before samples exist, the axes span ground to well above any threshold so the band reads as a band.
  const bounds = [...shown]
  if (threshold) bounds.push(threshold.low, threshold.high)
  if (!shown.length) bounds.push(0, Math.max(1, (threshold?.high ?? 0) * 1.8))
  const [lowest, highest] = extent(bounds)
  const levels = roundTicks({ low: lowest, high: highest, count: 5 })
  const bottom = Math.min(levels[0].value, lowest)
  const top = Math.max(levels.at(-1)!.value, highest, bottom + 1e-9)
  const coordinates = { plot, bottom, top, origin: start, timeSpan: Math.max(durationSeconds - start, 1e-30) }
  if (eye) {
    coordinates.origin = 0
    coordinates.timeSpan = 2
  }
  for (const level of levels) {
    let color: string = routeTones.paneEdge
    if (level.value === 0) color = routeTones.quiet
    const y = plotY(coordinates, level.value)
    drawing.lines!.push({ points: [{ x: plot.minX, y }, { x: plot.maxX, y }], strokeColor: color, strokeWidth: unit * 0.15 })
    routeText({ drawing, x: plot.minX - unit * 1.2, y, text: `${level.text} V`, color: routeTones.quiet, size, anchor: 'center_right' })
  }
  drawTimeAxis(drawing, { coordinates, eye, start, durationSeconds, unit, size })
  if (threshold) {
    const [low, high] = [plotY(coordinates, threshold.low), plotY(coordinates, threshold.high)]
    drawing.lines!.push({ points: [{ x: plot.minX, y: (low + high) / 2 }, { x: plot.maxX, y: (low + high) / 2 }], strokeColor: routeTones.threshold, strokeWidth: high - low, zIndex: -0.5, label: 'receiver threshold' })
  }
  if (state.running && !capture)
    for (let i = 1; i < 16; i++) {
      const offset = ((plot.maxX - plot.minX) * i) / 16
      drawing.lines!.push({ points: [{ x: plot.minX + offset, y: plot.minY }, { x: Math.min(plot.maxX, plot.minX + offset + (plot.maxY - plot.minY) * 0.5), y: plot.maxY }], strokeColor: 'rgba(251, 191, 36, 0.3)', strokeWidth: unit * 0.5 })
    }
  if (!capture) return drawing
  const curveContext = { coordinates, times, from, eye }
  if (far.length > 6 && !eye) {
    // A grey envelope of every far-end probe under the one curve that leaves the common band the most.
    const columns = Array.from({ length: 300 }, () => [Infinity, -Infinity])
    for (let j = from; j < times.length; j++) {
      const column = columns[Math.min(299, Math.floor(((times[j] - start) / Math.max(durationSeconds - start, 1e-30)) * 300))]
      for (const { entry } of far) column.splice(0, 2, Math.min(column[0], entry.voltageLevels[j]), Math.max(column[1], entry.voltageLevels[j]))
    }
    for (const [i, [low, high]] of columns.entries())
      if (high >= low) drawing.lines!.push({ points: [{ x: plotX(coordinates, start + ((i + 0.5) * (durationSeconds - start)) / 300), y: plotY(coordinates, low) }, { x: plotX(coordinates, start + ((i + 0.5) * (durationSeconds - start)) / 300), y: plotY(coordinates, high) + unit * 0.05 }], strokeColor: routeTones.envelope, strokeWidth: ((plot.maxX - plot.minX) / 300) * 1.05, zIndex: -0.4 })
    const all = far.flatMap(({ entry }) => entry.voltageLevels.slice(from)).sort((a, b) => a - b)
    const [low, high] = [all[Math.floor(all.length * 0.05)], all[Math.floor(all.length * 0.95)]]
    const worst = far.reduce((a, b) => {
      if (excursion({ levels: b.entry.voltageLevels.slice(from), low, high }) > excursion({ levels: a.entry.voltageLevels.slice(from), low, high })) return b
      return a
    })
    const style = styles[worst.index] ?? styles[0]
    for (const points of waveformCurve({ curveLevels: worst.entry.voltageLevels, period: unitInterval }, curveContext)) drawing.lines!.push({ points, strokeColor: style.color, strokeWidth: unit * 0.35, label: style.label, layer: 'waveform' })
    return drawing
  }
  for (const { entry, index } of [...series].sort((a, b) => Number(!probes[a.index]?.near) - Number(!probes[b.index]?.near))) {
    const style = styles[index] ?? { color: routeHue({ hue: 0 }), label: entry.name, unitInterval: undefined, differential: false }
    let width = 0.3
    let strokeDash: string | undefined
    if (probes[index]?.near) {
      width = 0.18
      strokeDash = '6 4'
    }
    for (const points of waveformCurve({ curveLevels: entry.voltageLevels, period: style.unitInterval ?? unitInterval }, curveContext))
      drawing.lines!.push({ points, strokeColor: style.color, strokeWidth: unit * width, strokeDash, label: style.label, layer: 'waveform' })
  }
  return drawing
}

interface PlotCoordinates {
  plot: Viewbox
  bottom: number
  top: number
  origin: number
  timeSpan: number
}

/** Use the board drawing when present, otherwise the default frame. */
function waveformCanvas(frame: ReturnType<typeof routeFrame>, board?: RoutedSections): GraphicsObject {
  if (board) return routeBoardDrawing({ circuit: board.circuitJson, scope: board.scope })
  return routeCanvas(frame)
}

/** Convert seconds, or unit intervals in an eye, to the plot. */
function plotX({ plot, origin, timeSpan }: PlotCoordinates, time: number): number {
  return plot.minX + ((time - origin) / timeSpan) * (plot.maxX - plot.minX)
}

/** Convert volts to the plot, bottom to top. */
function plotY({ plot, bottom, top }: PlotCoordinates, voltage: number): number {
  return plot.minY + ((voltage - bottom) / (top - bottom)) * (plot.maxY - plot.minY)
}

/** Draw the time scale for a transient capture or two-UI eye. */
function drawTimeAxis(drawing: GraphicsObject, { coordinates, eye, start, durationSeconds, unit, size }: {
  coordinates: PlotCoordinates
  eye: boolean
  start: number
  durationSeconds: number
  unit: number
  size: number
}): void {
  const { plot } = coordinates
  if (eye) {
    for (const tick of [0, 1, 2]) {
      drawing.lines!.push({ points: [{ x: plotX(coordinates, tick), y: plot.minY }, { x: plotX(coordinates, tick), y: plot.maxY }], strokeColor: routeTones.paneEdge, strokeWidth: unit * 0.15 })
      let label = '0'
      if (tick) label = `${tick} UI`
      routeText({ drawing, x: plotX(coordinates, tick), y: plot.minY - unit * 1.5, text: label, color: routeTones.quiet, size, anchor: 'top_center' })
    }
    return
  }
  const [scale, name] = ([[1, 's'], [1e3, 'ms'], [1e6, 'µs'], [1e9, 'ns'], [1e12, 'ps']] as const).find(([scale]) => durationSeconds * scale >= 1) ?? [1e12, 'ps']
  for (const tick of roundTicks({ low: start * scale, high: durationSeconds * scale, count: 5 })) {
    drawing.lines!.push({ points: [{ x: plotX(coordinates, tick.value / scale), y: plot.minY }, { x: plotX(coordinates, tick.value / scale), y: plot.minY - unit }], strokeColor: routeTones.quiet, strokeWidth: unit * 0.15 })
    routeText({ drawing, x: plotX(coordinates, tick.value / scale), y: plot.minY - unit * 1.5, text: `${tick.text} ${name}`, color: routeTones.quiet, size, anchor: 'top_center' })
  }
}

/** One probe's curve, cut at every fold of the eye. */
function waveformCurve({ curveLevels, period }: { curveLevels: readonly number[]; period: number }, {
  coordinates, times, from, eye,
}: {
  coordinates: PlotCoordinates
  times: readonly number[]
  from: number
  eye: boolean
}): Point[][] {
  if (!eye) return [waveformSampleIndices({ times, values: curveLevels, from, limit: 700 }).map((j) => ({ x: plotX(coordinates, times[j]), y: plotY(coordinates, curveLevels[j]) }))]
  const middle = extent(curveLevels).reduce((a, b) => a + b) / 2
  const crossing = curveLevels.findIndex((level, j) => j > 0 && (curveLevels[j - 1] - middle) * (level - middle) < 0)
  let origin = 0
  if (crossing > 0) origin = times[crossing]
  origin -= period / 2
  const runs: Point[][] = [[]]
  let last = -1
  for (const j of waveformSampleIndices({ times, values: curveLevels, from: 0, limit: 2500 })) {
    const phase = ((((times[j] - origin) / period) % 2) + 2) % 2
    if (phase < last) runs.push([])
    runs.at(-1)!.push({ x: plotX(coordinates, phase), y: plotY(coordinates, curveLevels[j]) })
    last = phase
  }
  return runs.filter((run) => run.length > 1)
}

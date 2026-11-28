import { type Datum, sampleAt } from "../chart"
import { crossings, type Transition } from "./waveforms"

export interface EyeFold {
  segments: Datum[][]
  height?: number
  widthFraction?: number
  crossingVoltage?: number
  violations: number
  betweenSamples: number
  mask: Datum[]
}

interface EyeOptions {
  points: Datum[]
  bitNs: number
  startNs: number
  skip: number
  phase: number
  crossingVoltage: number
  maskHeight: number
  maskWidth: number
}

/** Test a linear trace segment against a centered diamond using four half-plane clips. */
function hitsMask({
  first,
  second,
  center,
  halfWidth,
  halfHeight,
}: {
  first: Datum
  second: Datum
  center: Datum
  halfWidth: number
  halfHeight: number
}): boolean {
  if (!(halfWidth > 0) || !(halfHeight > 0)) return false
  let enter = 0
  let exit = 1
  for (const horizontal of [-1, 1])
    for (const vertical of [-1, 1]) {
      const a =
        (horizontal * (first[0] - center[0])) / halfWidth +
        (vertical * (first[1] - center[1])) / halfHeight
      const b =
        (horizontal * (second[0] - center[0])) / halfWidth +
        (vertical * (second[1] - center[1])) / halfHeight
      if (a > 1 && b > 1) return false
      if (a > 1 === b > 1) continue
      const at = (1 - a) / (b - a)
      if (a > 1) enter = Math.max(enter, at)
      else exit = Math.min(exit, at)
      if (enter > exit) return false
    }
  return true
}

/** The smallest circular arc containing the observed threshold crossings. */
interface CrossingArc {
  center: number
  spread: number
}

/** Find the empty arc rather than introducing a phase discontinuity at half a bit. */
function crossingArc({
  transitions,
  bitNs,
  startNs,
}: {
  transitions: Transition[]
  bitNs: number
  startNs: number
}): CrossingArc {
  const positions = transitions
    .map(({ x }) => {
      const cycles = (x - startNs) / bitNs
      return cycles - Math.floor(cycles)
    })
    .sort((a, b) => a - b)
  if (positions.length === 0) return { center: 0, spread: 1 }
  let gap = 0
  let arcStart = 0
  for (const [index, position] of positions.entries()) {
    const next = positions[index + 1] ?? positions[0] + 1
    if (next - position <= gap) continue
    gap = next - position
    arcStart = next
  }
  const spread = 1 - gap
  return { center: (arcStart + spread / 2) % 1, spread }
}

/** Average one direction of edges relative to their nearest expected bit boundary. */
function meanEdge({
  points,
  boundaries,
  offsetNs,
}: {
  points: Datum[]
  boundaries: number[]
  offsetNs: number
}): number {
  let total = 0
  let count = 0
  for (const boundary of boundaries) {
    const reading = sampleAt({ points, x: boundary + offsetNs })
    if (reading === undefined) continue
    total += reading
    count++
  }
  return total / count
}

/** Measure the voltage where the aligned mean rising and falling edges intersect. */
function measuredCrossing({
  points,
  transitions,
  bitNs,
  origin,
}: {
  points: Datum[]
  transitions: Transition[]
  bitNs: number
  origin: number
}): number | undefined {
  const rising: number[] = []
  const falling: number[] = []
  for (const { x, rising: up } of transitions) {
    const boundary = origin + Math.round((x - origin) / bitNs) * bitNs
    if (up) rising.push(boundary)
    else falling.push(boundary)
  }
  if (!rising.length || !falling.length) return
  let low = -bitNs / 2
  let high = bitNs / 2
  if (
    !(
      meanEdge({ points, boundaries: rising, offsetNs: low }) <=
      meanEdge({ points, boundaries: falling, offsetNs: low })
    ) ||
    !(
      meanEdge({ points, boundaries: rising, offsetNs: high }) >=
      meanEdge({ points, boundaries: falling, offsetNs: high })
    )
  )
    return
  // Sixteen bisections resolve the intersection to less than one hundredth of a percent of a bit.
  for (let step = 0; step < 16; step++) {
    const offsetNs = (low + high) / 2
    if (
      meanEdge({ points, boundaries: rising, offsetNs }) >
      meanEdge({ points, boundaries: falling, offsetNs })
    )
      high = offsetNs
    else low = offsetNs
  }
  const voltage = meanEdge({
    points,
    boundaries: rising,
    offsetNs: (low + high) / 2,
  })
  if (Number.isFinite(voltage)) return voltage
}

/** A sample on or inside the diamond violates the mask. */
function insideMask({
  point,
  center,
  halfWidth,
  halfHeight,
}: {
  point: Datum
  center: Datum
  halfWidth: number
  halfHeight: number
}): boolean {
  return (
    Math.abs(point[0] - center[0]) / halfWidth +
      Math.abs(point[1] - center[1]) / halfHeight <=
    1
  )
}

/** Fold complete windows around the measured eye and derive phase-independent aperture. */
export function foldEye({
  points,
  bitNs,
  startNs,
  skip,
  phase,
  crossingVoltage: threshold,
  maskHeight,
  maskWidth,
}: EyeOptions): EyeFold {
  const result: EyeFold = {
    segments: [],
    violations: 0,
    betweenSamples: 0,
    mask: [],
  }
  if (!(bitNs > 0) || points.length < 2) return result
  const last = points.at(-1)![0]
  const firstBit = startNs + Math.max(0, Math.floor(skip)) * bitNs
  const transitions = crossings({ points, threshold }).filter(
    ({ x }) => x >= firstBit,
  )
  const { center: crossingPhase, spread } = crossingArc({
    transitions,
    bitNs,
    startNs,
  })
  const origin = firstBit + crossingPhase * bitNs
  result.crossingVoltage = measuredCrossing({
    points,
    transitions,
    bitNs,
    origin,
  })
  const center: Datum = [1, result.crossingVoltage ?? threshold]
  const halfWidth = maskWidth / 2
  const halfHeight = maskHeight / 2
  result.mask = [
    [1 - halfWidth, center[1]],
    [1, center[1] + halfHeight],
    [1 + halfWidth, center[1]],
    [1, center[1] - halfHeight],
  ]
  let low = -Infinity
  let high = Infinity
  for (let time = origin + bitNs / 2; time <= last; time += bitNs) {
    const reading = sampleAt({ points, x: time })
    if (reading === undefined) continue
    if (reading < threshold) low = Math.max(low, reading)
    else high = Math.min(high, reading)
  }
  if (Number.isFinite(low) && Number.isFinite(high) && transitions.length > 0) {
    result.height = high - low
    result.widthFraction = 1 - spread
  }
  let sample = 0
  const windowOrigin = origin + (phase - 0.5) * bitNs
  for (
    let start = windowOrigin;
    start + 2 * bitNs <= last + bitNs * 1e-8;
    start += bitNs
  ) {
    const end = Math.min(last, start + 2 * bitNs)
    const first = sampleAt({ points, x: start })
    const final = sampleAt({ points, x: end })
    if (first === undefined || final === undefined) continue
    while (sample < points.length && points[sample][0] <= start) sample++
    const line: Datum[] = [[0, first]]
    for (let i = sample; i < points.length && points[i][0] < end; i++)
      line.push([(points[i][0] - start) / bitNs, points[i][1]])
    line.push([2, final])
    result.segments.push(line)
    let previousInside = false
    for (const [index, point] of line.entries()) {
      const inside = insideMask({ point, center, halfWidth, halfHeight })
      if (inside) result.violations++
      if (
        index > 0 &&
        !previousInside &&
        !inside &&
        hitsMask({
          first: line[index - 1],
          second: point,
          center,
          halfWidth,
          halfHeight,
        })
      )
        result.betweenSamples++
      previousInside = inside
    }
  }
  return result
}

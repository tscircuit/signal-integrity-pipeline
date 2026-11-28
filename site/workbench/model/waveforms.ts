import type { Datum } from "../chart"
import type { SimulationRun } from "../local-run"

export interface VoltageBounds {
  min: number
  max: number
}

/** Convert one probe to display units while preserving native ngspice timestamps. */
export function probePoints({
  run,
  index,
}: {
  run: SimulationRun
  index: number
}): Datum[] {
  return run.capture.timestampsSeconds.map((time, sample) => [
    time * 1e9,
    run.capture.probes[index].voltageLevels[sample],
  ])
}

/** Find the observed voltage extrema without spreading a large capture. */
export function voltageBounds(points: Datum[]): VoltageBounds {
  let min = Infinity
  let max = -Infinity
  for (const [, voltage] of points) {
    min = Math.min(min, voltage)
    max = Math.max(max, voltage)
  }
  return { min, max }
}

export interface Transition {
  x: number
  rising: boolean
}

/** Locate threshold crossings using piecewise-linear interpolation. */
export function crossings({
  points,
  threshold,
}: {
  points: Datum[]
  threshold: number
}): Transition[] {
  const transitions: Transition[] = []
  for (let i = 1; i < points.length; i++) {
    const [x0, v0] = points[i - 1]
    const [x1, v1] = points[i]
    if (x1 <= x0) continue
    const rising = v0 < threshold && v1 >= threshold
    const falling = v0 > threshold && v1 <= threshold
    if (!rising && !falling) continue
    transitions.push({
      x: x0 + ((x1 - x0) * (threshold - v0)) / (v1 - v0),
      rising,
    })
  }
  return transitions
}

/** First complete directed edge between the two thresholds. */
function edgeDuration({
  points,
  low,
  high,
  rising,
}: {
  points: Datum[]
  low: number
  high: number
  rising: boolean
}): number | undefined {
  const start = crossings({ points, threshold: rising ? low : high })
  const end = crossings({ points, threshold: rising ? high : low })
  for (const first of start.filter((item) => item.rising === rising)) {
    const reversed = start.find(
      (item) => item.rising !== rising && item.x > first.x,
    )
    const complete = end.find(
      (item) => item.rising === rising && item.x >= first.x,
    )
    if (complete && (!reversed || complete.x < reversed.x))
      return complete.x - first.x
  }
}

/** Measurements reported relative to the modeled swing and driver timing. */
export interface WaveMeasurements extends VoltageBounds {
  overshootMv?: number
  undershootMv?: number
  delayNs?: number
  riseNs?: number
  fallNs?: number
}

/** Measure extrema, first complete edges, and the first matched driver/receiver crossing. */
export function measureWaveform({
  points,
  nominalHigh,
  driver,
  bitNs,
}: {
  points: Datum[]
  nominalHigh?: number
  driver?: Datum[]
  bitNs?: number
}): WaveMeasurements {
  const { min, max } = voltageBounds(points)
  const low = nominalHigh === undefined ? min : 0
  const high = nominalHigh ?? max
  const swing = high - low
  const result: WaveMeasurements = { min, max }
  if (!(swing > 0)) return result
  if (nominalHigh !== undefined) {
    result.overshootMv = Math.max(0, max - high) * 1000
    result.undershootMv = Math.max(0, low - min) * 1000
  }
  result.riseNs = edgeDuration({
    points,
    low: low + swing * 0.2,
    high: low + swing * 0.8,
    rising: true,
  })
  result.fallNs = edgeDuration({
    points,
    low: low + swing * 0.2,
    high: low + swing * 0.8,
    rising: false,
  })
  if (!driver) return result
  const threshold = low + swing / 2
  const arrival = crossings({ points, threshold })
  const departure = crossings({ points: driver, threshold })
  for (const edge of departure) {
    const reflected = arrival.find(
      ({ x, rising }) =>
        rising === edge.rising &&
        x >= edge.x &&
        x - edge.x <= (bitNs ?? Infinity) / 2,
    )
    if (!reflected) continue
    result.delayNs = reflected.x - edge.x
    break
  }
  return result
}

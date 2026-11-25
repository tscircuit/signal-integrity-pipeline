import {
  bitWeights,
  type ConvertedBuffer,
  IbisError,
  type LogicalSchedule,
  switchingWeights,
} from "@tscircuit/ibis-to-spice"
import {
  findWaveformTailTruncation,
  STEADY_STATE_TOLERANCE,
  type SwitchingCoefficientSamples,
  type WaveformEdge,
  type WaveformTailTruncation,
} from "./switching-tail"

/** Preserve measured endpoints using the pinned converter's pre-edge hold interval. */
const HOLD_STEP_SECONDS = 1e-15
const HOLD_STEP_GAP_FRACTION = 1e-6

/** Measured switching samples and settled tails proven for one schedule. */
interface ScheduledSwitchingCoefficients {
  samples: SwitchingCoefficientSamples
  tails: WaveformTailTruncation[]
}

/** Stitch full measured coefficient edges, discarding only proven settled tails when necessary. */
export function scheduleSwitchingCoefficients({
  convertedBuffer,
  schedule,
  physicalPin,
}: {
  convertedBuffer: ConvertedBuffer
  schedule: LogicalSchedule
  physicalPin: string
}): ScheduledSwitchingCoefficients {
  const { buffer, corner } = convertedBuffer
  const pullup = Number(Boolean(schedule.initialState))
  const pulldown = 1 - pullup
  const samples: SwitchingCoefficientSamples = [[0, pullup, pulldown]]
  const tails: WaveformTailTruncation[] = []
  const edgeSamples = new Map<WaveformEdge, SwitchingCoefficientSamples>()
  for (const [i, transition] of schedule.transitions.entries()) {
    let edge: WaveformEdge = "falling"
    if (transition.state) edge = "rising"
    let coefficientSamples = edgeSamples.get(edge)
    if (!coefficientSamples) {
      coefficientSamples = switchingWeights(buffer, corner, edge)
      edgeSamples.set(edge, coefficientSamples)
    }
    if (coefficientSamples[0][0] !== 0) {
      throw new IbisError(
        "unsupported_waveforms",
        "Switching waveform must start at zero relative time",
      )
    }
    const nextSeconds = schedule.transitions[i + 1]?.time
    if (
      nextSeconds !== undefined &&
      transition.time + coefficientSamples[coefficientSamples.length - 1][0] >
        nextSeconds
    ) {
      const tail = findWaveformTailTruncation({
        buffer,
        corner,
        edge,
        coefficientSamples,
        physicalPin,
      })
      if (!tail || transition.time + tail.cutoffTimeSeconds > nextSeconds) {
        const detail =
          "has not settled before the next edge (1% fixture swing and 0.01 switching-coefficient tolerances)"
        const reason = "active-transition interruption is unsupported"
        throw new IbisError(
          "overlapping_edges",
          `${buffer.name}: actual ${edge} transition ${detail}; ${reason}`,
        )
      }
      coefficientSamples = coefficientSamples.filter(
        (row) => row[0] <= tail.cutoffTimeSeconds,
      )
      if (
        !tails.some(
          (entry) => entry.physicalPin === physicalPin && entry.edge === edge,
        )
      )
        tails.push(tail)
    }
    const last = samples[samples.length - 1]
    const stitchError = Math.max(
      Math.abs(coefficientSamples[0][1] - last[1]),
      Math.abs(coefficientSamples[0][2] - last[2]),
    )
    if (stitchError <= STEADY_STATE_TOLERANCE)
      coefficientSamples = [
        [0, last[1], last[2]],
        ...coefficientSamples.slice(1),
      ]
    if (stitchError > STEADY_STATE_TOLERANCE && transition.time > 0) {
      const gapSeconds = transition.time - last[0]
      const holdTimeSeconds =
        transition.time -
        Math.min(HOLD_STEP_SECONDS, gapSeconds * HOLD_STEP_GAP_FRACTION)
      if (holdTimeSeconds <= last[0] || holdTimeSeconds >= transition.time)
        throw new IbisError(
          "unsupported_waveforms",
          `${buffer.name}: ${edge} measured waveform and preceding edge disagree at the same time`,
        )
      samples.push([holdTimeSeconds, last[1], last[2]])
    }
    const endSeconds = Math.min(
      schedule.duration,
      transition.time + coefficientSamples[coefficientSamples.length - 1][0],
    )
    // Give upstream one edge at a time. It cannot share a knot between edges,
    // and its one measured waveform per direction cannot trim individual instances.
    const points = bitWeights(
      {
        ...convertedBuffer,
        weights: { rising: coefficientSamples, falling: coefficientSamples },
      },
      { ...schedule, transitions: [transition], duration: endSeconds },
    )
    // The hold sample above uses the actual preceding coefficient, not upstream's
    // logical idle value. An exact boundary sample can also be returned twice upstream.
    let previousEdgeTime = -Infinity
    for (const point of points) {
      const seconds = point[0]
      if (seconds < transition.time || seconds === previousEdgeTime) continue
      previousEdgeTime = seconds
      if (seconds === samples[samples.length - 1][0]) samples.pop()
      samples.push(point)
    }
  }
  const last = samples[samples.length - 1]
  if (last[0] < schedule.duration)
    samples.push([schedule.duration, last[1], last[2]])
  return { samples, tails }
}

import { hypotenuse } from "../kernel"
import type { TraceWire } from "./copper-geometry-types"
import { measureChordDistanceMm, projectWire } from "./copper-geometry-wire"
import type { CopperPoint } from "./geometry/types"

/** Discard zero-length chords after simplification. */
const MIN_CHORD_LENGTH_MM = 1e-9
/** Maximum separation between consecutive wires in one run. */
const WIRE_JOIN_TOLERANCE_MM = 1e-7

interface WireRun {
  points: CopperPoint[]
  physicalWires: TraceWire[]
  toleranceMm: number
}

/** A modeled chord and the original copper it replaces. */
export interface WireChord {
  wire: TraceWire
  physicalWires: TraceWire[]
}

/** Recursive chord acceptance bounds every original vertex, preserving width/layer/via boundaries. */
function* simplifyRun({
  start,
  end,
  run,
}: {
  start: number
  end: number
  run: WireRun
}): Generator<WireChord> {
  const { points, physicalWires, toleranceMm } = run
  const startPoint = points[start]
  const endPoint = points[end]
  let farthest = -1
  let maxDistanceMm = toleranceMm
  if (startPoint[0] === endPoint[0] && startPoint[1] === endPoint[1])
    maxDistanceMm = MIN_CHORD_LENGTH_MM
  for (let i = start + 1; i < end; i++) {
    const candidate = measureChordDistanceMm({
      point: points[i],
      startPoint,
      endPoint,
    })
    if (!(candidate > maxDistanceMm)) continue
    maxDistanceMm = candidate
    farthest = i
  }
  if (farthest >= 0) {
    yield* simplifyRun({ start, end: farthest, run })
    yield* simplifyRun({ start: farthest, end, run })
    return
  }
  const lengthMm = hypotenuse(
    endPoint[0] - startPoint[0],
    endPoint[1] - startPoint[1],
  )
  if (lengthMm < MIN_CHORD_LENGTH_MM) return
  yield {
    wire: {
      ...physicalWires[start],
      startPoint,
      endPoint,
      ...projectWire({ startPoint, endPoint, lengthMm }),
    },
    physicalWires: physicalWires.slice(start, end),
  }
}

/** Simplified wires and the total route lengths before and after simplification. */
interface SimplifiedWires {
  chords: WireChord[]
  originalLengthMm: number
  simplifiedLengthMm: number
}

/** Bounded Douglas-Peucker chords for densely tessellated curved routes; physical records remain unchanged. */
export function simplifyWires({
  wires,
  toleranceMm,
}: {
  wires: TraceWire[]
  toleranceMm: number
}): SimplifiedWires {
  const chords: WireChord[] = []
  let index = 0
  while (index < wires.length) {
    const runStart = index
    const firstWire = wires[index++]
    const points = [firstWire.startPoint, firstWire.endPoint]
    while (index < wires.length) {
      const wire = wires[index]
      const previousEndPoint = points[points.length - 1]
      if (
        wire.pcbTraceId !== firstWire.pcbTraceId ||
        wire.layer !== firstWire.layer ||
        wire.widthMm !== firstWire.widthMm
      )
        break
      const gapMm = hypotenuse(
        wire.startPoint[0] - previousEndPoint[0],
        wire.startPoint[1] - previousEndPoint[1],
      )
      if (gapMm > WIRE_JOIN_TOLERANCE_MM) break
      points.push(wire.endPoint)
      index++
    }
    const wireRun: WireRun = {
      points,
      physicalWires: wires.slice(runStart, index),
      toleranceMm,
    }
    for (const chord of simplifyRun({
      start: 0,
      end: points.length - 1,
      run: wireRun,
    }))
      chords.push({
        ...chord,
        wire: { ...chord.wire, wireIndex: chords.length },
      })
  }
  return {
    chords,
    originalLengthMm: wires.reduce(
      (sum, wire) => sum + wire.longitudinalMaxMm - wire.longitudinalMinMm,
      0,
    ),
    simplifiedLengthMm: chords.reduce(
      (sum, { wire }) => sum + wire.longitudinalMaxMm - wire.longitudinalMinMm,
      0,
    ),
  }
}

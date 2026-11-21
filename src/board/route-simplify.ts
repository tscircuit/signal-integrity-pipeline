import { hypotenuse } from "../kernel"
import type { RouteWire, RouteXY } from "./route-sections"

/** Treat near-vertical segments as vertical when choosing the canonical direction. */
const DIRECTION_TOLERANCE = 1e-9

/** Discard zero-length chords after simplifying, in millimeters. */
const MIN_CHORD_LENGTH_MM = 1e-9

/** Maximum separation between consecutive segments of a tessellated curve, in millimeters. */
const WIRE_JOIN_TOLERANCE_MM = 1e-7

/** Shortest point-to-chord distance in mm. */
export function chordDistance({
  point,
  a,
  b,
}: {
  point: RouteXY
  a: RouteXY
  b: RouteXY
}): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy),
    ),
  )
  return hypotenuse(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)
}

/** The wire's canonical direction and signed longitudinal and transverse coordinates. */
type WireProjection = Pick<RouteWire, "u" | "start" | "end" | "transverse">

/** Use one canonical projection for both original and simplified wire segments. */
export function projectRouteWire({
  a,
  b,
  length,
}: {
  a: RouteXY
  b: RouteXY
  length: number
}): WireProjection {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let direction = 1
  if (
    dx < -DIRECTION_TOLERANCE ||
    (Math.abs(dx) < DIRECTION_TOLERANCE && b[1] < a[1])
  )
    direction = -1
  const u: RouteXY = [(direction * dx) / length, (direction * dy) / length]
  const first = a[0] * u[0] + a[1] * u[1]
  const last = b[0] * u[0] + b[1] * u[1]
  return {
    u,
    start: Math.min(first, last),
    end: Math.max(first, last),
    transverse: -a[0] * u[1] + a[1] * u[0],
  }
}

interface WireRun {
  points: RouteXY[]
  seed: RouteWire
  toleranceMm: number
  output: RouteWire[]
}

/** Recursive chord acceptance bounds every original vertex, preserving width/layer/via boundaries. */
function simplifyRun({
  start,
  end,
  run,
}: {
  start: number
  end: number
  run: WireRun
}): void {
  const { points, seed, toleranceMm, output } = run
  const a = points[start]
  const b = points[end]
  let farthest = -1
  let distance = toleranceMm
  for (let i = start + 1; i < end; i++) {
    const candidate = chordDistance({ point: points[i], a, b })
    if (!(candidate > distance)) continue
    distance = candidate
    farthest = i
  }
  if (farthest >= 0) {
    simplifyRun({ start, end: farthest, run })
    simplifyRun({ start: farthest, end, run })
    return
  }
  const length = hypotenuse(b[0] - a[0], b[1] - a[1])
  if (length < MIN_CHORD_LENGTH_MM) return
  output.push({
    ...seed,
    id: output.length,
    a,
    b,
    ...projectRouteWire({ a, b, length }),
  })
}

/** Simplified wires and the total route lengths before and after simplification. */
interface SimplifiedRouteWires {
  wires: RouteWire[]
  originalLengthMm: number
  simplifiedLengthMm: number
}

/** Bounded Douglas-Peucker chords for densely tessellated curved routes; physical records remain unchanged. */
export function simplifyRouteWires({
  wires,
  toleranceMm,
}: {
  wires: RouteWire[]
  toleranceMm: number
}): SimplifiedRouteWires {
  const output: RouteWire[] = []
  let index = 0
  while (index < wires.length) {
    const seed = wires[index++]
    const run = [seed]
    while (index < wires.length) {
      const wire = wires[index]
      const previous = run.at(-1)!
      if (
        wire.trace !== seed.trace ||
        wire.layer !== seed.layer ||
        wire.width !== seed.width
      )
        break
      const gap = hypotenuse(
        wire.a[0] - previous.b[0],
        wire.a[1] - previous.b[1],
      )
      if (gap > WIRE_JOIN_TOLERANCE_MM) break
      run.push(wire)
      index++
    }
    const points = [seed.a, ...run.map((wire) => wire.b)]
    const wireRun: WireRun = { points, seed, toleranceMm, output }
    simplifyRun({ start: 0, end: points.length - 1, run: wireRun })
  }
  return {
    wires: output,
    originalLengthMm: wires.reduce(
      (sum, wire) => sum + wire.end - wire.start,
      0,
    ),
    simplifiedLengthMm: output.reduce(
      (sum, wire) => sum + wire.end - wire.start,
      0,
    ),
  }
}

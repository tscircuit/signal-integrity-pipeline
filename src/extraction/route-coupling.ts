import type { RouteSlice, RouteWire } from "../board"
import type { RouteCoefficients } from "./route-lines"

/** Retain a pair if either normalized mutual coefficient reaches 0.5%. */
const COUPLING_THRESHOLD = 0.005

/** Solved normalized coupling and retention decision for one route-wire pair. */
export interface RouteCoupling {
  wires: RouteWire["id"][]
  capacitive: number
  inductive: number
  retained: boolean
}

/** Partition by pairwise solved coupling, retaining a pair if either normalized mutual exceeds 0.5%.
 * Connected components keep intervening conductors together; this is a local pair screen,
 * not a bound on aggregate waveform error or on fields beyond the geometry admission cap.
 */
export function routeCoupling({
  slice,
  solve,
  records,
}: {
  slice: RouteSlice
  solve: (slice: RouteSlice) => RouteCoefficients
  records: RouteCoupling[]
}): RouteSlice[] {
  const groups = slice.wires.map((_, i) => i)
  for (let i = 0; i < slice.wires.length; i++) {
    for (let j = i + 1; j < slice.wires.length; j++) {
      const first = slice.wires[i]
      const second = slice.wires[j]
      const line = solve({ ...slice, wires: [first, second] })
      const capacitive =
        Math.abs(line.C[0][1]) / Math.sqrt(line.C[0][0] * line.C[1][1])
      const inductive =
        Math.abs(line.L[0][1]) / Math.sqrt(line.L[0][0] * line.L[1][1])
      const retained = Math.max(capacitive, inductive) >= COUPLING_THRESHOLD
      records.push({
        wires: [first.id, second.id],
        capacitive,
        inductive,
        retained,
      })
      if (!retained) continue
      const from = groups[j]
      const to = groups[i]
      for (let k = 0; k < groups.length; k++) {
        if (groups[k] === from) groups[k] = to
      }
    }
  }
  return [...new Set(groups)].map((group) => ({
    ...slice,
    wires: slice.wires.filter((_, i) => groups[i] === group),
  }))
}

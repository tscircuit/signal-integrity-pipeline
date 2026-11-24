import type { CopperPoint, TraceWire } from "../board"
import {
  causalLossPoles,
  causalLossResponse,
  type ExtractedRouteSlice,
  type ExtractedRoutes,
  referenceSeries,
} from "../extraction"
import { hypotenuse, type Snapshot } from "../kernel"
import {
  RouteEnergy,
  seriesEnergy,
  shuntEnergy,
  skinEnergy,
} from "./route-energy"
import type { RouteEndpoint } from "./route-network"

/** Significant digits kept from the field-derived skin resistance. */
const SKIN_RESISTANCE_PRECISION = 9

/** The Wheeler wall recession amplifies rounding noise before the network is assembled. */
function skinResistanceForDeck(resistance: number): number {
  return Number(resistance.toPrecision(SKIN_RESISTANCE_PRECISION))
}

/** Tolerance for finding the arc cell that contains a point (mm). */
const CELL_POSITION_TOLERANCE = 1e-7
/** Distance below which touching wire ends belong to the same run (mm). */
const WIRE_JOIN_TOLERANCE = 1e-6
/** Keep integration cuts distinct from the slice endpoints (mm). */
const CUT_EDGE_TOLERANCE = 1e-8
/** Integration intervals shorter than this are treated as zero (m). */
const MIN_INTEGRATION_LENGTH = 1e-12
/** Base spatial sampling density before refinement. */
const DEFAULT_CELLS_PER_RISE = 10
/** Coarsest supported sampling of one rising edge. */
const MIN_CELLS_PER_RISE = 0.5
/** Tighten cell spacing once a route delay exceeds two rise times. */
const DISPERSION_RISE_TIMES = 2
/** More than two wire ends at the same position mark a branch. */
const THROUGH_CONTACT_COUNT = 2
/** The causal dielectric fit preserves the per-length C value at 1 GHz. */
const DIELECTRIC_REFERENCE_HZ = 1e9
/** Millimetres in one metre. */
const MM_PER_METRE = 1000

/** A stamped node and its longitudinal position in millimetres. */
interface RouteLadderNode {
  position: number
  node: string
}

/** The stamped lines, per-wire nodes and cell statistics of a route ladder. */
export interface RouteLadder {
  lines: string[]
  cells: number
  maximumDelaySeconds: number
  /** Cells whose own conductor skin share was reduced to keep the shared remainder passive. */
  cappedSkinCells: number
  wireNodes: Map<number, RouteLadderNode[]>
}

/** Largest absolute row sum of a per-length matrix. */
function matrixInfinityNorm(matrix: ExtractedRouteSlice["line"]["L"]): number {
  return Math.max(
    ...matrix.map((row) =>
      row.reduce((total, entry) => total + Math.abs(entry), 0),
    ),
  )
}

/** Deliberately conservative modal delay upper bound from matrix infinity norms. */
function delaySecondsPerMetre(slice: ExtractedRouteSlice): number {
  const inductanceNorm = matrixInfinityNorm(slice.line.L)
  const capacitanceNorm = matrixInfinityNorm(slice.line.C)
  return Math.sqrt(inductanceNorm * capacitanceNorm)
}

interface ArcCell {
  start: number
  end: number
  before: string
  after: string
}
interface ArcWire {
  offset: number
  length: number
  cells: number[]
  sign: number
}

/** Longest propagation time across the current set of arc cells. */
function maxCellDelay({
  cells,
  delaySecondsPerMetre,
}: {
  cells: ArcCell[]
  delaySecondsPerMetre: number
}): number {
  return Math.max(
    ...cells.map(
      (cell) => ((cell.end - cell.start) / MM_PER_METRE) * delaySecondsPerMetre,
    ),
  )
}

/** A wire and the board coordinates of a point on its route arc. */
type ArcPoint = {
  wire: Snapshot<TraceWire>
  position: Snapshot<CopperPoint>
}

/** Locate a physical point along the original (simplified) polyline, including its bends. */
function arcPoint({
  distance,
  run,
  arc,
}: {
  distance: number
  run: Snapshot<TraceWire>[]
  arc: ReadonlyMap<number, ArcWire>
}): ArcPoint {
  const wire =
    run.find((wire) => {
      const { offset, length } = arc.get(wire.wireIndex)!
      return distance <= offset + length + CELL_POSITION_TOLERANCE
    }) ?? run.at(-1)!
  const entry = arc.get(wire.wireIndex)!
  const fraction = Math.max(
    0,
    Math.min(1, (distance - entry.offset) / entry.length),
  )
  const x =
    wire.startPoint[0] + fraction * (wire.endPoint[0] - wire.startPoint[0])
  const y =
    wire.startPoint[1] + fraction * (wire.endPoint[1] - wire.startPoint[1])
  return { wire, position: [x, y] }
}

/** Project arc distance onto the wire's signed longitudinal axis. */
function wirePosition({
  wire,
  entry,
  distance,
}: {
  wire: Snapshot<TraceWire>
  entry: ArcWire
  distance: number
}): number {
  if (entry.sign > 0) return wire.longitudinalMinMm + distance - entry.offset
  return wire.longitudinalMaxMm - distance + entry.offset
}

/** A copper layer and its rounded board coordinates. */
export type RouteContactKey = string

/** Number of decimal places used to group points at wire contacts (in mm). */
const CONTACT_PRECISION = 6

/** Identify a contact by its copper layer and rounded board position. */
export function routeContactKey({
  layer,
  point,
}: {
  layer: TraceWire["layer"]
  point: Snapshot<CopperPoint>
}): RouteContactKey {
  const coordinates = point
    .map((value) => value.toFixed(CONTACT_PRECISION))
    .join(",")
  return `${layer}:${coordinates}`
}

interface RouteLadderInput {
  extracted: ExtractedRoutes
  endpoint: RouteEndpoint
  riseSeconds: number
  refinement?: number
  cellsPerRise?: number
}

/** Integrate every local matrix energy onto delay-bounded route-arc cells, independent of curve tessellation. */
export function* routeLadderSteps({
  extracted,
  endpoint,
  riseSeconds,
  refinement = 1,
  cellsPerRise = DEFAULT_CELLS_PER_RISE,
}: RouteLadderInput): Generator<RouteLadder, RouteLadder> {
  const validRefinement = Number.isInteger(refinement) && refinement >= 1
  if (!Number.isFinite(riseSeconds) || riseSeconds <= 0 || !validRefinement) {
    throw new Error(
      "Finite positive rise time and positive integer spatial refinement required",
    )
  }
  if (!Number.isFinite(cellsPerRise) || cellsPerRise < MIN_CELLS_PER_RISE) {
    throw new Error(
      `Cells per rise time must be finite and at least ${MIN_CELLS_PER_RISE}`,
    )
  }
  const lines: string[] = []
  const wireNodes: RouteLadder["wireNodes"] = new Map()
  const wireEntries = extracted.slices.flatMap((slice) =>
    slice.wires.map((wire) => [wire.wireIndex, wire] as const),
  )
  const wires = [...new Map(wireEntries).values()].sort(
    (a, b) => a.wireIndex - b.wireIndex,
  )
  const maximumDelaySecondsPerMetre = Math.max(
    ...extracted.slices.map(delaySecondsPerMetre),
  )
  const targetMm =
    (riseSeconds / cellsPerRise / refinement / maximumDelaySecondsPerMetre) *
    MM_PER_METRE
  const dispersionMm =
    ((DISPERSION_RISE_TIMES * riseSeconds) / maximumDelaySecondsPerMetre) *
    MM_PER_METRE
  const cells: ArcCell[] = []
  const arc = new Map<number, ArcWire>()
  const contacts = new Map<RouteContactKey, number>()
  for (const wire of wires) {
    for (const point of [wire.startPoint, wire.endPoint]) {
      const key = routeContactKey({ layer: wire.layer, point })
      contacts.set(key, (contacts.get(key) ?? 0) + 1)
    }
  }
  let cursor = 0
  while (cursor < wires.length) {
    const seed = wires[cursor++]
    if (
      endpoint({ wire: seed, point: seed.startPoint }) ===
      endpoint({ wire: seed, point: seed.endPoint })
    )
      continue
    const run = [seed]
    while (cursor < wires.length) {
      const wire = wires[cursor]
      const previous = run.at(-1)!
      const junction =
        contacts.get(
          routeContactKey({ layer: wire.layer, point: wire.startPoint }),
        ) ?? 0
      if (
        wire.startTouchesPort ||
        junction > THROUGH_CONTACT_COUNT ||
        wire.pcbTraceId !== seed.pcbTraceId
      )
        break
      if (wire.layer !== seed.layer || wire.widthMm !== seed.widthMm) break
      const separation = hypotenuse(
        wire.startPoint[0] - previous.endPoint[0],
        wire.startPoint[1] - previous.endPoint[1],
      )
      if (separation > WIRE_JOIN_TOLERANCE) break
      run.push(wire)
      cursor++
    }
    let length = 0
    for (const wire of run) {
      let sign = -1
      if (
        (wire.endPoint[0] - wire.startPoint[0]) * wire.direction[0] +
          (wire.endPoint[1] - wire.startPoint[1]) * wire.direction[1] >
        0
      )
        sign = 1
      arc.set(wire.wireIndex, {
        offset: length,
        length: wire.longitudinalMaxMm - wire.longitudinalMinMm,
        cells: [],
        sign,
      })
      length += wire.longitudinalMaxMm - wire.longitudinalMinMm
    }
    // Ladder dispersion accumulates along a run: phase error ~ delay x cell delay^2. Runs longer than two rise times
    // shrink their cells by sqrt(two rise times / run delay), which keeps the edge ripple independent of length.
    const count = Math.max(
      1,
      Math.ceil(
        (length / targetMm) * Math.max(1, Math.sqrt(length / dispersionMm)),
      ),
    )
    const indices = Array.from({ length: count }, (_, i) => cells.length + i)
    for (let i = 0; i < count; i++) {
      const start = (length * i) / count
      const end = (length * (i + 1)) / count
      const a = arcPoint({ distance: start, run, arc })
      const b = arcPoint({ distance: end, run, arc })
      cells.push({
        start,
        end,
        before: endpoint({ wire: a.wire, point: a.position }),
        after: endpoint({ wire: b.wire, point: b.position }),
      })
    }
    for (const wire of run) {
      const entry = arc.get(wire.wireIndex)!
      entry.cells = indices
      const records = indices.flatMap((index) => {
        const cell = cells[index]
        return [cell.start, cell.end].flatMap((distance) => {
          const start = entry.offset - CELL_POSITION_TOLERANCE
          const end = entry.offset + entry.length + CELL_POSITION_TOLERANCE
          if (!(distance >= start && distance <= end)) return []
          let node = cell.after
          if (distance === cell.start) node = cell.before
          return [{ position: wirePosition({ wire, entry, distance }), node }]
        })
      })
      if (!records.length) {
        const middle = entry.offset + entry.length / 2
        const cell = cells[indices.find((index) => cells[index].end >= middle)!]
        records.push(
          { position: wire.longitudinalMinMm, node: cell.before },
          { position: wire.longitudinalMaxMm, node: cell.after },
        )
      }
      wireNodes.set(wire.wireIndex, records)
    }
    yield {
      lines,
      cells: cells.length,
      maximumDelaySeconds: maxCellDelay({
        cells,
        delaySecondsPerMetre: maximumDelaySecondsPerMetre,
      }),
      cappedSkinCells: 0,
      wireNodes,
    }
  }
  const nodeNames = [
    ...new Set(cells.flatMap((cell) => [cell.before, cell.after])),
  ].filter((node) => node !== "0")
  const nodeIds = new Map(nodeNames.map((node, i) => [node, i]))
  const [R, L, skin, C, D] = [
    cells.length,
    cells.length,
    cells.length,
    nodeNames.length,
    nodeNames.length,
  ].map((size) => new RouteEnergy({ size }))
  const strip = cells.map(() => 0)
  for (const slice of extracted.slices) {
    const grounded = slice.wires.flatMap((wire, i) => {
      if (arc.has(wire.wireIndex)) return []
      return [i]
    })
    const series = referenceSeries({ line: slice.line, grounded })
    const cuts = [slice.startMm, slice.endMm]
    for (const wire of slice.wires) {
      const entry = arc.get(wire.wireIndex)
      if (!entry) continue
      for (const index of entry.cells) {
        for (const distance of [cells[index].start, cells[index].end]) {
          const position = wirePosition({ wire, entry, distance })
          const interior =
            position > slice.startMm + CUT_EDGE_TOLERANCE &&
            position < slice.endMm - CUT_EDGE_TOLERANCE
          if (interior) cuts.push(position)
        }
      }
    }
    cuts.sort((a, b) => a - b)
    for (let part = 1; part < cuts.length; part++) {
      const metres = (cuts[part] - cuts[part - 1]) / MM_PER_METRE
      if (metres < MIN_INTEGRATION_LENGTH) continue
      const middle = (cuts[part] + cuts[part - 1]) / 2
      const entries = slice.wires.map((wire) => {
        const entry = arc.get(wire.wireIndex)
        if (!entry) return undefined
        let local = wire.longitudinalMaxMm - middle
        if (entry.sign > 0) local = middle - wire.longitudinalMinMm
        const distance = entry.offset + local
        const index = entry.cells.find((index) => {
          const { start, end } = cells[index]
          return (
            distance >= start - CELL_POSITION_TOLERANCE &&
            distance <= end + CELL_POSITION_TOLERANCE
          )
        })
        if (index === undefined)
          throw new Error("Route arc cell did not cover a geometric section")
        const { before, after } = cells[index]
        if (entry.sign > 0) {
          return {
            index,
            sign: entry.sign,
            before: nodeIds.get(before),
            after: nodeIds.get(after),
          }
        }
        return {
          index,
          sign: entry.sign,
          before: nodeIds.get(after),
          after: nodeIds.get(before),
        }
      })
      for (let i = 0; i < entries.length; i++) {
        for (let j = 0; j < entries.length; j++) {
          const a = entries[i]
          const b = entries[j]
          if (!a || !b) continue
          const signedLength = metres * a.sign * b.sign
          R.add({
            row: a.index,
            column: b.index,
            coefficient: slice.line.dcResistance[i][j] * signedLength,
          })
          L.add({
            row: a.index,
            column: b.index,
            coefficient: series.L[i][j] * signedLength,
          })
          skin.add({
            row: a.index,
            column: b.index,
            coefficient:
              skinResistanceForDeck(series.skinResistance[i][j]) * signedLength,
          })
          if (i === j)
            strip[a.index] +=
              skinResistanceForDeck(series.stripSkinResistance[i][i]) * metres
          for (const side of ["before", "after"] as const) {
            if (a[side] === undefined || b[side] === undefined) continue
            C.add({
              row: a[side]!,
              column: b[side]!,
              coefficient: (slice.line.C[i][j] * metres) / 2,
            })
            D.add({
              row: a[side]!,
              column: b[side]!,
              coefficient: (slice.line.dielectricLoss[i][j] * metres) / 2,
            })
          }
        }
      }
    }
  }
  const dc = cells.map((_, i) => R.rows[i].get(i) ?? 0)
  const before = cells.map((cell) => cell.before)
  const after = cells.map((cell) => cell.after)
  const current = cells.map((_, i) => `ARCd${i}`)
  for (const line of seriesEnergy({
    tag: "ARCD",
    before,
    after: current,
    matrix: R,
    kind: "R",
  }))
    lines.push(line)
  const stages = causalLossPoles().map((_, p) =>
    cells.map((_, i) => `ARCp${p}n${i}`),
  )
  const stripStages = causalLossPoles().map((_, p) =>
    cells.map((_, i) => `ARCq${p}n${i}`),
  )
  const { lines: skinLines, cappedSkinCells } = skinEnergy({
    tag: "ARC",
    before: current,
    stripStages,
    stages,
    matrix: skin,
    poles: causalLossPoles(),
    dc,
    strip,
  })
  for (const line of skinLines) lines.push(line)
  for (const line of seriesEnergy({
    tag: "ARCL",
    before: stages.at(-1)!,
    after,
    matrix: L,
    kind: "L",
  }))
    lines.push(line)
  const dielectricAtReference = causalLossResponse({
    frequency: DIELECTRIC_REFERENCE_HZ,
  }).dielectricCapacitance
  const capacitance = C.scaled(1)
  for (const [i, row] of D.rows.entries()) {
    for (const [j, loss] of row) {
      const adjusted = (C.rows[i].get(j) ?? 0) - dielectricAtReference * loss
      capacitance.rows[i].set(j, adjusted)
    }
  }
  for (const line of shuntEnergy({
    tag: "ARCC",
    nodes: nodeNames,
    matrix: capacitance,
  }))
    lines.push(line)
  for (const [p, pole] of causalLossPoles().entries())
    for (const line of shuntEnergy({
      tag: `ARCG${p}`,
      nodes: nodeNames,
      matrix: D.scaled(pole.dielectric),
      rate: pole.rate,
    }))
      lines.push(line)
  return {
    lines,
    cells: cells.length,
    maximumDelaySeconds: maxCellDelay({
      cells,
      delaySecondsPerMetre: maximumDelaySecondsPerMetre,
    }),
    cappedSkinCells,
    wireNodes,
  }
}

/** Drain the canonical ladder assembly when interactive stepping is unnecessary. */
export function routeLadder(input: RouteLadderInput): RouteLadder {
  const steps = routeLadderSteps(input)
  let result = steps.next()
  while (!result.done) result = steps.next()
  return result.value
}

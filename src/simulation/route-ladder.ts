import type { RouteWire, RouteXY } from "../board"
import {
  causalLossPoles,
  causalLossResponse,
  type ExtractedRouteSlice,
  type ExtractedRoutes,
  referenceSeries,
} from "../extraction"
import {
  RouteEnergy,
  seriesEnergy,
  shuntEnergy,
  skinEnergy,
} from "./route-energy"

export interface RouteLadder {
  lines: string[]
  cells: number
  maximumDelaySeconds: number
  /** Cells whose own conductor skin share was reduced to keep the shared remainder passive. */
  cappedSkinCells: number
  wireNodes: Map<number, { position: number; node: string }[]>
}

/** Deliberately conservative modal delay upper bound from matrix infinity norms. */
function delayPerMetre(slice: ExtractedRouteSlice): number {
  return Math.sqrt(
    Math.max(
      ...slice.line.L.map((row) =>
        row.reduce((total, entry) => total + Math.abs(entry), 0),
      ),
    ) *
      Math.max(
        ...slice.line.C.map((row) =>
          row.reduce((total, entry) => total + Math.abs(entry), 0),
        ),
      ),
  )
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

/** Locate a physical point along the original (simplified) polyline, including its bends. */
function arcPoint(
  distance: number,
  { run, arc }: { run: RouteWire[]; arc: ReadonlyMap<number, ArcWire> },
): { wire: RouteWire; position: RouteXY } {
  const wire =
    run.find(
      (wire) =>
        distance <= arc.get(wire.id)!.offset + arc.get(wire.id)!.length + 1e-7,
    ) ?? run.at(-1)!
  const entry = arc.get(wire.id)!
  const fraction = Math.max(
    0,
    Math.min(1, (distance - entry.offset) / entry.length),
  )
  return {
    wire,
    position: [
      wire.a[0] + fraction * (wire.b[0] - wire.a[0]),
      wire.a[1] + fraction * (wire.b[1] - wire.a[1]),
    ],
  }
}

/** Project arc distance onto the wire's signed longitudinal axis. */
function wirePosition({
  wire,
  entry,
  distance,
}: {
  wire: RouteWire
  entry: ArcWire
  distance: number
}): number {
  if (entry.sign > 0) return wire.start + distance - entry.offset
  return wire.end - distance + entry.offset
}

type RouteContactKey = string

interface RouteLadderInput {
  extracted: ExtractedRoutes
  endpoint: (wire: RouteWire, point: RouteXY) => string
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
  cellsPerRise = 10,
}: RouteLadderInput): Generator<RouteLadder, RouteLadder> {
  if (
    !(riseSeconds > 0) ||
    !Number.isInteger(refinement) ||
    refinement < 1 ||
    refinement > 4
  )
    throw new Error(
      "Positive rise time and bounded integer spatial refinement (1..4) required",
    )
  if (!(cellsPerRise >= 0.5 && cellsPerRise <= 40))
    throw new Error("Cells per rise time must be in [0.5,40]")
  const lines: string[] = []
  const wireNodes: RouteLadder["wireNodes"] = new Map()
  const wires = [
    ...new Map(
      extracted.slices.flatMap((slice) =>
        slice.wires.map((wire) => [wire.id, wire] as const),
      ),
    ).values(),
  ].sort((a, b) => a.id - b.id)
  const maximumDelayPerMetre = Math.max(...extracted.slices.map(delayPerMetre))
  const targetMm =
    (riseSeconds / cellsPerRise / refinement / maximumDelayPerMetre) * 1000
  const dispersionMm = ((2 * riseSeconds) / maximumDelayPerMetre) * 1000
  const cells: ArcCell[] = []
  const arc = new Map<number, ArcWire>()
  const contacts = new Map<RouteContactKey, number>()
  for (const wire of wires)
    for (const point of [wire.a, wire.b]) {
      const key = `${wire.layer}:${point.map((coordinate) => coordinate.toFixed(6)).join(",")}`
      contacts.set(key, (contacts.get(key) ?? 0) + 1)
    }
  let cursor = 0
  while (cursor < wires.length) {
    const seed = wires[cursor++]
    if (endpoint(seed, seed.a) === endpoint(seed, seed.b)) continue
    const run = [seed]
    while (cursor < wires.length) {
      const wire = wires[cursor]
      const previous = run.at(-1)!
      const junction =
        contacts.get(
          `${wire.layer}:${wire.a.map((coordinate) => coordinate.toFixed(6)).join(",")}`,
        ) ?? 0
      if (
        wire.aPort ||
        junction > 2 ||
        wire.trace !== seed.trace ||
        wire.layer !== seed.layer ||
        wire.width !== seed.width ||
        Math.hypot(wire.a[0] - previous.b[0], wire.a[1] - previous.b[1]) > 1e-6
      )
        break
      run.push(wire)
      cursor++
    }
    let length = 0
    for (const wire of run) {
      let sign = -1
      if (
        (wire.b[0] - wire.a[0]) * wire.u[0] +
          (wire.b[1] - wire.a[1]) * wire.u[1] >
        0
      )
        sign = 1
      arc.set(wire.id, {
        offset: length,
        length: wire.end - wire.start,
        cells: [],
        sign,
      })
      length += wire.end - wire.start
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
      const a = arcPoint(start, { run, arc })
      const b = arcPoint(end, { run, arc })
      cells.push({
        start,
        end,
        before: endpoint(a.wire, a.position),
        after: endpoint(b.wire, b.position),
      })
    }
    for (const wire of run) {
      const entry = arc.get(wire.id)!
      entry.cells = indices
      const records = indices.flatMap((index) => {
        const cell = cells[index]
        return [cell.start, cell.end].flatMap((distance) => {
          if (
            !(
              distance >= entry.offset - 1e-7 &&
              distance <= entry.offset + entry.length + 1e-7
            )
          )
            return []
          let node = cell.after
          if (distance === cell.start) node = cell.before
          return [{ position: wirePosition({ wire, entry, distance }), node }]
        })
      })
      if (!records.length) {
        const middle = entry.offset + entry.length / 2
        const cell = cells[indices.find((index) => cells[index].end >= middle)!]
        records.push(
          { position: wire.start, node: cell.before },
          { position: wire.end, node: cell.after },
        )
      }
      wireNodes.set(wire.id, records)
    }
    yield {
      lines,
      cells: cells.length,
      maximumDelaySeconds: Math.max(
        ...cells.map(
          (cell) => ((cell.end - cell.start) / 1000) * maximumDelayPerMetre,
        ),
      ),
      cappedSkinCells: 0,
      wireNodes,
    }
  }
  const nodeNames = [
    ...new Set(cells.flatMap((cell) => [cell.before, cell.after])),
  ].filter((node) => node !== "0")
  const nodeIds = new Map(nodeNames.map((node, i) => [node, i]))
  /** Bound actual stored coupling terms, rather than unrelated route cells. */
  const budget = { entries: 0 }
  const R = new RouteEnergy(cells.length, budget)
  const L = new RouteEnergy(cells.length, budget)
  const skin = new RouteEnergy(cells.length, budget)
  const strip = cells.map(() => 0)
  const C = new RouteEnergy(nodeNames.length, budget)
  const D = new RouteEnergy(nodeNames.length, budget)
  for (const slice of extracted.slices) {
    const series = referenceSeries(
      slice.line,
      slice.wires.flatMap((wire, i) => {
        if (arc.has(wire.id)) return []
        return [i]
      }),
    )
    const cuts = [slice.start, slice.end]
    for (const wire of slice.wires) {
      const entry = arc.get(wire.id)
      if (!entry) continue
      for (const index of entry.cells)
        for (const distance of [cells[index].start, cells[index].end]) {
          const position = wirePosition({ wire, entry, distance })
          if (position > slice.start + 1e-8 && position < slice.end - 1e-8)
            cuts.push(position)
        }
    }
    cuts.sort((a, b) => a - b)
    for (let part = 1; part < cuts.length; part++) {
      const metres = (cuts[part] - cuts[part - 1]) / 1000
      if (metres < 1e-12) continue
      const middle = (cuts[part] + cuts[part - 1]) / 2
      const entries = slice.wires.map((wire) => {
        const entry = arc.get(wire.id)
        if (!entry) return undefined
        let local = wire.end - middle
        if (entry.sign > 0) local = middle - wire.start
        const distance = entry.offset + local
        const index = entry.cells.find(
          (index) =>
            distance >= cells[index].start - 1e-7 &&
            distance <= cells[index].end + 1e-7,
        )!
        if (index === undefined)
          throw new Error("Route arc cell did not cover a geometric section")
        const { before, after } = cells[index]
        if (entry.sign > 0)
          return {
            index,
            sign: entry.sign,
            before: nodeIds.get(before),
            after: nodeIds.get(after),
          }
        return {
          index,
          sign: entry.sign,
          before: nodeIds.get(after),
          after: nodeIds.get(before),
        }
      })
      for (let i = 0; i < entries.length; i++)
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
            coefficient: series.skinResistance[i][j] * signedLength,
          })
          if (i === j)
            strip[a.index] += series.stripSkinResistance[i][i] * metres
          for (const side of ["before", "after"] as const)
            if (a[side] !== undefined && b[side] !== undefined) {
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
  const dc = cells.map((_, i) => R.rows[i].get(i) ?? 0)
  const before = cells.map((cell) => cell.before)
  const after = cells.map((cell) => cell.after)
  const current = cells.map((_, i) => `ARCd${i}`)
  seriesEnergy({
    lines,
    tag: "ARCD",
    before,
    after: current,
    matrix: R,
    kind: "R",
  })
  const stages = causalLossPoles().map((_, p) =>
    cells.map((_, i) => `ARCp${p}n${i}`),
  )
  const stripStages = causalLossPoles().map((_, p) =>
    cells.map((_, i) => `ARCq${p}n${i}`),
  )
  const cappedSkinCells = skinEnergy({
    lines,
    tag: "ARC",
    before: current,
    stripStages,
    stages,
    matrix: skin,
    poles: causalLossPoles(),
    dc,
    strip,
  })
  seriesEnergy({
    lines,
    tag: "ARCL",
    before: stages.at(-1)!,
    after,
    matrix: L,
    kind: "L",
  })
  const dielectricAtReference = causalLossResponse(1e9).dielectricCapacitance
  const capacitance = C.scaled(1)
  for (const [i, row] of D.rows.entries())
    for (const [j, loss] of row)
      capacitance.rows[i].set(
        j,
        (C.rows[i].get(j) ?? 0) - dielectricAtReference * loss,
      )
  shuntEnergy({ lines, tag: "ARCC", nodes: nodeNames, matrix: capacitance })
  for (const [p, pole] of causalLossPoles().entries())
    shuntEnergy({
      lines,
      tag: `ARCG${p}`,
      nodes: nodeNames,
      matrix: D.scaled(pole.dielectric),
      rate: pole.rate,
    })
  return {
    lines,
    cells: cells.length,
    maximumDelaySeconds: Math.max(
      ...cells.map(
        (cell) => ((cell.end - cell.start) / 1000) * maximumDelayPerMetre,
      ),
    ),
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

import { hypotenuse } from "../kernel"
import {
  type ConnectivityMap,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "./connectivity"
import type { SourceTraceId } from "./ids"
import { type RouteWire, routePosition } from "./route-sections"
import type { CircuitJson, SourceTrace } from "./schema"

/** Require more than this shared length before merging parallel copper. */
const MIN_OVERLAP_LENGTH_MM = 1e-6

/** Geometric tolerance for touching edges, short intervals and coincident join endpoints. */
const UNION_TOLERANCE_MM = 1e-7

/** Round direction keys before grouping nominally parallel copper. */
const DIRECTION_DECIMAL_PLACES = 7

type CopperGroupKey = string

/** Parallel wires considered together for physical copper overlap. */
type RouteWireGroup = RouteWire[]

/** Compress a connected set of overlapping same-net copper bodies. */
function root({
  index,
  parents,
}: {
  index: number
  parents: number[]
}): number {
  if (parents[index] === index) return index
  parents[index] = root({ index: parents[index], parents })
  return parents[index]
}

/** Relative direction of the physical endpoints along the canonical wire axis. */
function wireDirection(wire: RouteWire): number {
  if (
    (wire.b[0] - wire.a[0]) * wire.u[0] + (wire.b[1] - wire.a[1]) * wire.u[1] >
    0
  )
    return 1
  return -1
}

/** The electrical seed shared by all traces on the net. */
function wireNet({
  source,
  connectivity,
}: {
  source: SourceTrace
  connectivity: ConnectivityMap
}): string {
  const port =
    source.connected_source_port_ids[0] ?? source.connected_source_net_ids?.[0]
  if (!port) return source.source_trace_id
  return [...sourceNetMembers({ connectivity, seed: port })].sort()[0]
}

/** Partition parallel wires into connected sets based on their physical overlap. */
function connectedWires(group: RouteWireGroup): Iterable<RouteWireGroup> {
  const parents = group.map((_, i) => i)
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i]
      const b = group[j]
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start)
      if (!(overlap > MIN_OVERLAP_LENGTH_MM)) continue
      const separation = Math.abs(a.transverse - b.transverse)
      if (!(separation <= (a.width + b.width) / 2 + UNION_TOLERANCE_MM))
        continue
      parents[root({ index: j, parents })] = root({ index: i, parents })
    }
  }
  const components = new Map<number, RouteWireGroup>()
  for (const [i, wire] of group.entries()) {
    const component = root({ index: i, parents })
    components.set(component, [...(components.get(component) ?? []), wire])
  }
  return components.values()
}

/** Join laterally touching wires present in one longitudinal interval. */
function transverseClusters(active: RouteWire[]): RouteWireGroup[] {
  const clusters: RouteWireGroup[] = []
  for (const wire of active) {
    const last = clusters.at(-1)
    if (!last) {
      clusters.push([wire])
      continue
    }
    const rightEdge = Math.max(
      ...last.map((wire) => wire.transverse + wire.width / 2),
    )
    const leftEdge = wire.transverse - wire.width / 2
    if (leftEdge <= rightEdge + UNION_TOLERANCE_MM) {
      last.push(wire)
      continue
    }
    clusters.push([wire])
  }
  return clusters
}

/** Build the union wire and the joins from the original endpoints to its centreline. */
function unionCluster({
  cluster,
  start,
  end,
}: Pick<RouteWire, "start" | "end"> & {
  cluster: RouteWireGroup
}): RouteWire {
  const wire = [...cluster].sort((a, b) => a.id - b.id)[0]
  const low = Math.min(
    ...cluster.map((wire) => wire.transverse - wire.width / 2),
  )
  const high = Math.max(
    ...cluster.map((wire) => wire.transverse + wire.width / 2),
  )
  const body = {
    ...wire,
    start,
    end,
    width: high - low,
    transverse: (low + high) / 2,
  }
  const endpoints = [start, end]
  if (wireDirection(wire) < 0) endpoints.reverse()
  const [a, b] = endpoints.map((position) =>
    routePosition({ wire: body, position }),
  )
  const joins = cluster.flatMap((original) =>
    [start, end].map((position) => ({
      source: original.source,
      trace: original.trace,
      from: routePosition({ wire: original, position }),
      to: routePosition({ wire: body, position }),
    })),
  )
  const lateralJoins = joins.filter((join) => {
    return (
      hypotenuse(join.from[0] - join.to[0], join.from[1] - join.to[1]) >
      UNION_TOLERANCE_MM
    )
  })
  return {
    ...body,
    a,
    b,
    joins: lateralJoins,
  }
}

/** Split connected wires at overlap ends and union each interval across its width. */
function unionComponent({
  component,
  result,
}: {
  component: RouteWireGroup
  result: RouteWire[]
}): void {
  if (component.length === 1) {
    result.push(component[0])
    return
  }
  const cuts = [
    ...new Set(component.flatMap((wire) => [wire.start, wire.end])),
  ].sort((a, b) => a - b)
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1]
    const end = cuts[i]
    if (end - start < UNION_TOLERANCE_MM) continue
    const middle = (start + end) / 2
    const active = component.filter(
      (wire) => wire.start < middle && wire.end > middle,
    )
    active.sort((a, b) => a.transverse - b.transverse)
    for (const cluster of transverseClusters(active))
      result.push(unionCluster({ cluster, start, end }))
  }
}

/** Exact transverse metal union, with equipotential lateral joins at overlap-patch ends. */
export function unionRouteWires({
  wires,
  circuit,
}: {
  wires: RouteWire[]
  circuit: CircuitJson
}): RouteWire[] {
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const nets = new Map<SourceTraceId, string>()
  const sources = circuit.filter((record) => record.type === "source_trace")
  const groups = new Map<CopperGroupKey, RouteWire[]>()
  for (const wire of wires) {
    let net = nets.get(wire.source)
    if (!net) {
      const source = sources.find(
        (source) => source.source_trace_id === wire.source,
      )!
      net = wireNet({ source, connectivity })
      nets.set(wire.source, net)
    }
    const key = [
      net,
      wire.layer,
      ...wire.u.map((value) => value.toFixed(DIRECTION_DECIMAL_PLACES)),
    ].join(":")
    groups.set(key, [...(groups.get(key) ?? []), wire])
  }
  const result: RouteWire[] = []
  for (const group of groups.values()) {
    for (const component of connectedWires(group)) {
      unionComponent({ component, result })
    }
  }
  const original = new Map(wires.map((wire) => [wire.id, wire]))
  result.sort((a, b) => {
    if (a.id !== b.id) return a.id - b.id
    return wireDirection(original.get(a.id)!) * (a.start - b.start)
  })
  return result.map((wire, id) => ({ ...wire, id }))
}

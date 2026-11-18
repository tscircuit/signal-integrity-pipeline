import { connectedSourceIds, type CircuitJson, type SimulationPcbDriverReceiverChannel } from '../board'

export type ConnectedSourceId = string

type CopperPointKey = string
type CopperPoint = { x: number; y: number; layer: string }
type CopperGraph = Map<CopperPointKey, Set<CopperPointKey>>
type PcbTrace = Extract<CircuitJson[number], { type: 'pcb_trace' }>
type RoutePoint = Exclude<PcbTrace['route'][number], { route_type: 'through_pad' }>

/** Copper reachable through two-terminal passives, excluding power and ground branches. */
export function signalTopology({ circuit, seed, rails }: {
  circuit: CircuitJson
  seed: ConnectedSourceId
  rails: Set<ConnectedSourceId>
}): Set<ConnectedSourceId> {
  const found = connectedSourceIds(circuit, seed)
  const ports = circuit.filter(r => r.type === 'source_port')
  const passives = circuit.filter(r => r.type === 'source_component').filter(r => ['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(r.ftype))
  let changed = true
  while (changed) {
    changed = false
    for (const component of passives) {
      const pins = ports.filter(port => port.source_component_id === component.source_component_id).map(port => port.source_port_id)
      if (pins.length !== 2 || pins.some(pin => rails.has(pin)) || !pins.some(pin => found.has(pin))) continue
      for (const pin of pins) for (const id of connectedSourceIds(circuit, pin)) {
        if (found.has(id)) continue
        found.add(id)
        changed = true
      }
    }
  }
  return found
}

/** Select the approached layer when the routed point is a via. */
function routeLayer(point: RoutePoint, viaSide: 'from_layer' | 'to_layer'): string {
  if (point.route_type === 'via') return point[viaSide]
  return point.layer
}

/** Stable physical identity at the geometry admission tolerance. */
function recordCopperPoint(points: Map<CopperPointKey, CopperPoint>, point: CopperPoint): CopperPointKey {
  const key = `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)},${point.layer}`
  points.set(key, point)
  return key
}

/** Add an undirected physical edge. */
function joinCopperPoints(graph: CopperGraph, { a, b }: { a: CopperPointKey; b: CopperPointKey }): void {
  if (a === b) return
  if (!graph.has(a)) graph.set(a, new Set())
  if (!graph.has(b)) graph.set(b, new Set())
  graph.get(a)!.add(b)
  graph.get(b)!.add(a)
}

/** All vertices physically reachable from the given terminals. */
function reachable(starts: CopperPointKey[], graph: CopperGraph): Set<CopperPointKey> {
  const found = new Set(starts)
  for (const key of found) for (const next of graph.get(key) ?? []) found.add(next)
  return found
}

/** Verify physical connectivity through passives and reject branched routed graphs independently of source grouping. */
export function validateSignalGraph({ circuit, signals, rails, allowUnroutedTraces }: {
  circuit: CircuitJson
  signals: SimulationPcbDriverReceiverChannel[]
  rails: Set<ConnectedSourceId>
  allowUnroutedTraces: boolean
}): void {
  const drivers = signals.map(({ driver }) => {
    if ('source_port_id' in driver) return [driver.source_port_id]
    return [driver.p_source_port_id, driver.n_source_port_id]
  })
  const selected = new Set(drivers.flatMap(ports => ports.flatMap(port => [...signalTopology({ circuit, seed: port, rails })])))
  const sourceTraces = new Set(circuit.filter(r => r.type === 'source_trace').filter(trace => trace.connected_source_port_ids.some(port => selected.has(port)) && !trace.connected_source_port_ids.some(port => rails.has(port))).map(trace => trace.source_trace_id))
  const routes = circuit.filter(r => r.type === 'pcb_trace').filter(r => sourceTraces.has(r.source_trace_id ?? ''))
  const ports = circuit.filter(r => r.type === 'pcb_port').filter(r => selected.has(r.source_port_id))
  const edges: { layer: string; ax: number; ay: number; bx: number; by: number }[] = []
  const points = new Map<CopperPointKey, CopperPoint>()
  const graph: CopperGraph = new Map()
  for (const route of routes) for (let i = 1; i < route.route.length; i++) {
    const a = route.route[i - 1]
    const b = route.route[i]
    if (a.route_type === 'through_pad' || b.route_type === 'through_pad') continue
    const layer = routeLayer(a, 'to_layer')
    const first = recordCopperPoint(points, { x: a.x, y: a.y, layer })
    const last = recordCopperPoint(points, { x: b.x, y: b.y, layer: routeLayer(b, 'from_layer') })
    if (b.route_type === 'via') {
      const otherSide = recordCopperPoint(points, { x: b.x, y: b.y, layer: b.to_layer })
      joinCopperPoints(graph, { a: last, b: otherSide })
    }
    if (first !== last) edges.push({ layer, ax: a.x, ay: a.y, bx: b.x, by: b.y })
  }
  const terminals = new Map<ConnectedSourceId, CopperPointKey[]>()
  for (const port of ports) terminals.set(port.source_port_id, port.layers.map(layer => recordCopperPoint(points, { x: port.x, y: port.y, layer })))
  // Split at every physical junction, including a branch terminating inside another segment.
  for (const edge of edges) {
    const dx = edge.bx - edge.ax
    const dy = edge.by - edge.ay
    const length = dx * dx + dy * dy
    const vertices = [...points].flatMap(([key, p]) => {
      const t = ((p.x - edge.ax) * dx + (p.y - edge.ay) * dy) / length
      if (p.layer === edge.layer && t >= -1e-8 && t <= 1 + 1e-8 && Math.abs((p.x - edge.ax) * dy - (p.y - edge.ay) * dx) < 1e-5 * Math.sqrt(length)) return [{ key, t }]
      return []
    }).sort((a, b) => a.t - b.t)
    for (let i = 1; i < vertices.length; i++) joinCopperPoints(graph, { a: vertices[i - 1].key, b: vertices[i].key })
  }
  for (const source of circuit.filter(r => r.type === 'source_port').filter(r => selected.has(r.source_port_id))) {
    if (terminals.has(source.source_port_id)) continue
    const copper = connectedSourceIds(circuit, source.source_port_id)
    terminals.set(source.source_port_id, ports.filter(p => copper.has(p.source_port_id)).flatMap(p => terminals.get(p.source_port_id) ?? []))
  }
  const copperGraph = new Map([...graph].map(([key, values]) => [key, new Set(values)]))
  for (const component of circuit.filter(r => r.type === 'source_component').filter(r => ['simple_resistor', 'simple_capacitor', 'simple_inductor'].includes(r.ftype))) {
    const pins = circuit.filter(r => r.type === 'source_port').filter(r => r.source_component_id === component.source_component_id).map(p => p.source_port_id)
    if (pins.length !== 2 || pins.some(pin => rails.has(pin))) continue
    for (const a of terminals.get(pins[0]) ?? []) for (const b of terminals.get(pins[1]) ?? []) joinCopperPoints(graph, { a, b })
  }
  for (const [index, signal] of signals.entries()) {
    for (const [leg, port] of drivers[index].entries()) {
      const topology = signalTopology({ circuit, seed: port, rails })
      if (!allowUnroutedTraces) {
        const traces = new Set(circuit.filter(record => record.type === 'source_trace').filter(trace => trace.connected_source_port_ids.some(id => topology.has(id)) && !trace.connected_source_port_ids.some(id => rails.has(id))).map(trace => trace.source_trace_id))
        const selected = new Set(ports.filter(pin => topology.has(pin.source_port_id) && !rails.has(pin.source_port_id)).map(pin => pin.pcb_port_id))
        const error = circuit.find(record => (record.type === 'pcb_trace_missing_error' && traces.has(record.source_trace_id)) || (record.type === 'pcb_port_not_connected_error' && record.pcb_port_ids.some(id => selected.has(id))))
        if (error) throw new Error(`Signal "${signal.name}" is not routed between ${port} and its receivers (${error.type}).`)
      }
      const starts = terminals.get(port) ?? []
      const connected = reachable(starts, graph)
      const copper = reachable(starts, copperGraph)
      const routed = [...copper].some(key => copperGraph.has(key))
      if (routed && (signal.receivers.length > 1 || starts.some(key => (copperGraph.get(key)?.size ?? 0) > 1) || [...connected].some(key => (copperGraph.get(key)?.size ?? 0) > 2))) throw new Error(`Signal "${signal.name}": branched routed graphs are not implemented yet.`)
      if (allowUnroutedTraces) continue
      const receivers = signal.receivers.map(receiver => {
        if ('source_port_id' in receiver) return receiver.source_port_id
        if (leg === 0) return receiver.p_source_port_id
        return receiver.n_source_port_id
      })
      const required = circuit.filter(r => r.type === 'source_trace').filter(r => r.connected_source_port_ids.some(id => topology.has(id)) && !r.connected_source_port_ids.some(id => rails.has(id))).flatMap(r => r.connected_source_port_ids)
      for (const target of new Set([...receivers, ...required])) if (!(terminals.get(target) ?? []).some(key => connected.has(key))) throw new Error(`Signal "${signal.name}" is not routed between ${port} and ${target}.`)
    }
  }
}

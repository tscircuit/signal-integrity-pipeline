/**
 * One routed net, from the pipeline's own board and extraction data, as
 *   - model.json: geometry, materials and ports for tools/openems/run_net.py (openEMS FDTD), and
 *   - ladder.cir: the pipeline's ladder, via and pad corrections for the same copper, as a 50 ohm .ac deck.
 * Both sides have lossless copper and the same dielectric: lossless by default, or the pipeline's nine Debye poles
 * (docs/physics-coverage.md).
 *
 * CLI: tsx scripts/openems-net.ts <circuit.json> <seed source_port_id> <ground source id> <output dir> [scope mm]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { channelCopperScope, connectedSourceIds, resolveRouteVias, routeContactFrame, routeReferences, segmentRoutes, type CircuitJson, type RouteWire, type RouteXY } from '../src/board'
import { causalLossPoles, causalLossResponse, RouteFieldsSolver, type ExtractedRoutes } from '../src/extraction'
import { routeLadder, routeOblique, routeTransitions } from '../src/simulation'

export interface OpenemsNetOptions {
  seedPortId: string
  groundId: string
  scopeDistanceMm?: number
  /** Ladder cell rise time; 35 ps keeps cells near 3.5 ps, accurate to the 10 GHz analysis band. */
  ladderRiseSeconds?: number
  marginMm?: number
  maskMm?: number
  maximumFrequencyHz?: number
  frequencyPoints?: number
  /** Leave every port after P1 open on both sides: a one-port TDR. A via-in-pad BGA end has no plane under its pad
   * (the barrel fills it and the antipad clears the plane), so a lumped port there would float. */
  openFarEnd?: boolean
  /** Default true: tan(delta) = 0 on both sides. False keeps the pipeline's nine Debye poles (about 25x slower FDTD). */
  losslessDielectric?: boolean
}
type Box = { x0: number; y0: number; x1: number; y1: number }
type Ring = RouteXY[]
export interface OpenemsBand { zMin: number; zMax: number; er: number; tanD: number; epsInf: number; poles: { delta: number; tau: number }[] }
export interface OpenemsPort { name: string; sourcePortId: string; x: number; y: number; width: number; height: number; zPad: number; zPlane: number }
export interface OpenemsModel {
  units: 'mm'
  region: Box & { zMin: number; zMax: number }
  maximumFrequencyHz: number
  frequencyPoints: number
  copper: { name: string; zMin: number; zMax: number }[]
  bands: OpenemsBand[]
  traces: { trace: string; selected: boolean; layer: string; zMin: number; zMax: number; width: number; a: RouteXY; b: RouteXY }[]
  joints: { layer: string; zMin: number; zMax: number; x: number; y: number; radius: number }[]
  pads: { id: string; layer: string; zMin: number; zMax: number; ring: Ring }[]
  pours: { id: string; net: string; layer: string; zMin: number; zMax: number; outer: Ring; holes: Ring[] }[]
  vias: { id: string; selected: boolean; x: number; y: number; radius: number; padRadius: number; zMin: number; zMax: number; padLayers: string[] }[]
  antipads: { via: string; layer: string; x: number; y: number; radius: number; zMin: number; zMax: number }[]
  ports: OpenemsPort[]
  markers: { label: string; roundTripSeconds: number }[]
}

/** Sutherland–Hodgman clip of one ring against an axis-aligned box. */
export function clipRing(ring: Ring, box: Box): Ring {
  const edges: [(p: RouteXY) => boolean, (a: RouteXY, b: RouteXY) => RouteXY][] = [
    [p => p[0] >= box.x0, (a, b) => [box.x0, a[1] + (b[1] - a[1]) * (box.x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= box.x1, (a, b) => [box.x1, a[1] + (b[1] - a[1]) * (box.x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= box.y0, (a, b) => [a[0] + (b[0] - a[0]) * (box.y0 - a[1]) / (b[1] - a[1]), box.y0]],
    [p => p[1] <= box.y1, (a, b) => [a[0] + (b[0] - a[0]) * (box.y1 - a[1]) / (b[1] - a[1]), box.y1]],
  ]
  let output = ring
  for (const [inside, cross] of edges) {
    const input = output
    output = []
    for (const [i, point] of input.entries()) {
      const previous = input[(i + input.length - 1) % input.length]
      if (inside(point)) {
        if (!inside(previous)) output.push(cross(previous, point))
        output.push(point)
      } else if (inside(previous)) output.push(cross(previous, point))
    }
    if (!output.length) return []
  }
  return output
}

/** The pipeline's dielectric as openEMS Debye terms: eps(w) = epsInf + sum(delta / (1 + j w tau)), Re eps(1 GHz) = er. */
export function debyeBand(zMin: number, zMax: number, er: number, tanD: number): OpenemsBand {
  const poles = causalLossPoles()
  return { zMin, zMax, er, tanD, epsInf: er * (1 - tanD * causalLossResponse(1e9).dielectricCapacitance),
    poles: tanD ? poles.map(pole => ({ delta: er * tanD * pole.dielectric, tau: 1 / pole.rate })) : [] }
}

/** Ordered points of a source net's routed copper, walked from one port by joining trace ends. */
function chainPoints(circuit: CircuitJson, traceIds: string[], start: RouteXY): { x: number; y: number; layer: string }[] {
  const traces = circuit.filter(record => record.type === 'pcb_trace').filter(trace => traceIds.includes(trace.pcb_trace_id))
  const left = new Set(traces.map(trace => trace.pcb_trace_id))
  const points: { x: number; y: number; layer: string }[] = []
  let cursor = start
  while (left.size) {
    const next = traces.filter(trace => left.has(trace.pcb_trace_id)).flatMap(trace => {
      const route = resolveRouteVias(circuit, trace).map(point => ({ x: point.x, y: point.y, layer: point.route_type === 'via' ? point.to_layer : point.layer }))
      return [{ trace, route }, { trace, route: [...route].reverse() }]
    }).find(({ route }) => Math.hypot(route[0].x - cursor[0], route[0].y - cursor[1]) < 1e-3)
    if (!next) break
    left.delete(next.trace.pcb_trace_id)
    points.push(...next.route)
    cursor = [next.route.at(-1)!.x, next.route.at(-1)!.y]
  }
  return points
}

/** Build both sides of the openEMS comparison for one net. Geometry comes only from segmentRoutes and pcb records. */
export function openemsNet(circuit: CircuitJson, options: OpenemsNetOptions): { model: OpenemsModel; deck: string; extracted: ExtractedRoutes; warnings: string[] } {
  const selected = connectedSourceIds(circuit, options.seedPortId)
  const ground = connectedSourceIds(circuit, options.groundId)
  const scope = channelCopperScope(circuit, selected, ground, new Set(), options.scopeDistanceMm ?? 1)
  const geometry = segmentRoutes(circuit, scope)
  const masks = circuit.filter(record => record.type === 'pcb_stackup')[0]?.layers.filter(layer => layer.layer_type === 'soldermask') ?? []
  const fields = new RouteFieldsSolver({ geometry, circuitJson: circuit, scope, maskThicknessMm: options.maskMm ?? masks[0]?.thickness ?? null, artifactPrefix: 'openems' })
  fields.solve()
  if (fields.failed) throw new Error(fields.error ?? 'Route fields failed')
  const solved = fields.getOutput().value
  // Like-for-like with PEC openEMS copper: DC and skin resistance are scaled by 1e-6, not zeroed. Zero values emit
  // 0 ohm || 0 H Foster stages, which made ngspice .ac non-passive (|S11|^2 + |S21|^2 = 1.5) and left coupled
  // multiport nodes singular (13 h stuck in gmin stepping on DDR3 BA0). Only this comparison ladder changes.
  // A lossless dielectric drops the Foster branches, leaving C at the 1 GHz permittivity on both sides.
  const lossless = options.losslessDielectric ?? true
  const materials = lossless ? { ...solved.materials, maskLoss: 0, substrateLoss: 0 } : solved.materials
  const extracted: ExtractedRoutes = { ...solved, materials, slices: solved.slices.map(slice => ({ ...slice, line: { ...slice.line,
    dcResistance: slice.line.dcResistance.map(row => row.map(value => value * 1e-6)), skinResistance: slice.line.skinResistance.map(row => row.map(value => value * 1e-6)),
    stripSkinResistance: slice.line.stripSkinResistance.map(row => row.map(value => value * 1e-6)),
    dielectricLoss: lossless ? slice.line.dielectricLoss.map(row => row.map(() => 0)) : slice.line.dielectricLoss } })) }
  const layers = geometry.stack.copperLayers
  /** Copper layer z range in mm. */
  const layer = (name: string): { zMin: number; zMax: number } => {
    const found = layers.find(entry => entry.name === name)
    if (!found) throw new Error(`Unknown copper layer ${name}`)
    return { zMin: found.zMinMm, zMax: found.zMaxMm }
  }
  const ports = circuit.filter(record => record.type === 'pcb_port').filter(port => selected.has(port.source_port_id))
    .flatMap(port => port.layers.filter(name => routeContactFrame(geometry, scope, name, [port.x, port.y])).map(name => ({ port, name })))
  if (ports.length < 2) throw new Error(`Net of ${options.seedPortId} has ${ports.length} routed ports; two or more required`)
  const selectedTraces = scope.selectedPcbTraceIds
  const first = circuit.filter(record => record.type === 'pcb_trace').find(trace => trace.pcb_trace_id === selectedTraces[0])!
  const origin = resolveRouteVias(circuit, first)[0]
  ports.sort((a, b) => Math.hypot(a.port.x - origin.x, a.port.y - origin.y) - Math.hypot(b.port.x - origin.x, b.port.y - origin.y))
  const chain = chainPoints(circuit, selectedTraces, [ports[0].port.x, ports[0].port.y])
  const far = chain.at(-1)
  if (far && ports.length > 1) {
    const rest = ports.slice(1).sort((a, b) => Math.hypot(b.port.x - far.x, b.port.y - far.y) - Math.hypot(a.port.x - far.x, a.port.y - far.y))
    ports.splice(1, ports.length - 1, ...rest.reverse())
  }
  const portNodes = new Map(ports.map(({ port, name }, i) => [`${name}:${port.x.toFixed(6)},${port.y.toFixed(6)}`, `P${i + 1}`]))
  const known = new Map<string, string>(portNodes)
  /** Same coordinate keying as RouteNetworkSolver: actual copper joins, ports named P1..Pn. */
  const endpoint = (wire: RouteWire, point: RouteXY): string => {
    if (scope.nonReferenceRailTraceIds.includes(wire.trace)) return '0'
    const id = `${wire.layer}:${point.map(n => n.toFixed(6)).join(',')}`
    let node = known.get(id)
    if (!node) {
      node = `n${known.size}`
      known.set(id, node)
    }
    return node
  }
  const aliases = geometry.wires.flatMap(wire => (wire.joins ?? []).map(join => [endpoint(wire, join.from), endpoint(wire, join.to)])).filter(([a, b]) => a !== b).map(([a, b], i) => `RJOIN${i} ${a} ${b} 1e-6`)
  const ladder = routeLadder(extracted, endpoint, options.ladderRiseSeconds ?? 35e-12)
  const oblique = routeOblique(geometry, extracted, ladder, scope, materials)
  const transitions = routeTransitions(circuit, scope, geometry, endpoint, options.groundId)
  const nodes = [...new Set([...known.values()])].filter(node => node !== '0')
  const maximumFrequencyHz = options.maximumFrequencyHz ?? 10e9
  const frequencyPoints = options.frequencyPoints ?? 1000
  const step = maximumFrequencyHz / frequencyPoints
  const deck = ['Pipeline ladder for one net, lossless copper, 50 ohm ports (scripts/openems-net.ts)',
    '.options klu reltol=1e-4 abstol=1e-12 vntol=1e-7 pivrel=0.1',
    ...aliases, ...ladder.lines, ...oblique.lines, ...transitions.lines,
    ...nodes.map((node, i) => `RBIAS${i} ${node} 0 1e9`),
    'VS1 S1 0 dc 0 ac 2', 'RS1 S1 P1 50', ...(options.openFarEnd ? [] : ports.slice(1).map((_, i) => `RL${i + 2} P${i + 2} 0 50`)),
    '.control', `ac lin ${frequencyPoints} ${step} ${maximumFrequencyHz}`, 'set wr_singlescale', 'set wr_vecnames',
    `wrdata ladder-ac.txt ${(options.openFarEnd ? ports.slice(0, 1) : ports).map((_, i) => `v(P${i + 1})`).join(' ')}`, 'quit', '.endc', '.end', ''].join('\n')

  const pcbTraces = circuit.filter(record => record.type === 'pcb_trace').filter(trace => scope.pcbTraceIds.includes(trace.pcb_trace_id))
  const selectedWires = geometry.wires.filter(wire => selectedTraces.includes(wire.trace))
  const vias = circuit.filter(record => record.type === 'pcb_via').filter(via => scope.pcbViaIds.includes(via.pcb_via_id))
  const selectedVias = vias.filter(via => pcbTraces.some(trace => selectedTraces.includes(trace.pcb_trace_id) && (via.pcb_trace_id === trace.pcb_trace_id || via.source_trace_id === trace.source_trace_id)))
  const margin = options.marginMm ?? 3
  const xs = [...selectedWires.flatMap(wire => [wire.a[0], wire.b[0]]), ...ports.map(({ port }) => port.x), ...selectedVias.map(via => via.x)]
  const ys = [...selectedWires.flatMap(wire => [wire.a[1], wire.b[1]]), ...ports.map(({ port }) => port.y), ...selectedVias.map(via => via.y)]
  const box: Box = { x0: Math.min(...xs) - margin, x1: Math.max(...xs) + margin, y0: Math.min(...ys) - margin, y1: Math.max(...ys) + margin }
  /** Point inside the model region. */
  const inside = (x: number, y: number): boolean => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
  const stackBottom = Math.min(...layers.map(entry => entry.zMinMm))
  const stackTop = Math.max(...layers.map(entry => entry.zMaxMm))
  const boundaries = [...new Set([stackBottom, stackTop, ...geometry.stack.dielectrics.flatMap(entry => [entry.zMinMm, entry.zMaxMm])])].sort((a, b) => a - b)
  const top = layer('top')
  const bottom = layer('bottom')
  // routeCrossSection's slabs: copper-layer volume takes the nearest laminate; outer copper and its overcoat take mask.
  const bands = boundaries.slice(1).map((z, i) => {
    const middle = (boundaries[i] + z) / 2
    const nearest = [...geometry.stack.dielectrics].sort((a, b) => Math.abs((a.zMinMm + a.zMaxMm) / 2 - middle) - Math.abs((b.zMinMm + b.zMaxMm) / 2 - middle))[0]
    return debyeBand(boundaries[i], z, nearest.relativePermittivity!, materials.substrateLoss)
  }).filter(band => band.zMin >= bottom.zMax - 1e-9 && band.zMax <= top.zMin + 1e-9)
  bands.push(debyeBand(top.zMin, top.zMax + materials.maskMm, materials.maskEr, materials.maskLoss), debyeBand(bottom.zMin - materials.maskMm, bottom.zMax, materials.maskEr, materials.maskLoss))
  bands.sort((a, b) => a.zMin - b.zMin)
  // Copper that leaves the region continues into the absorbing boundary, a matched end.
  const traces = geometry.wires.filter(wire => !scope.nonReferenceRailTraceIds.includes(wire.trace))
    .filter(wire => Math.max(wire.a[0], wire.b[0]) >= box.x0 && Math.min(wire.a[0], wire.b[0]) <= box.x1 && Math.max(wire.a[1], wire.b[1]) >= box.y0 && Math.min(wire.a[1], wire.b[1]) <= box.y1)
    .map(wire => ({ trace: wire.trace, selected: selectedTraces.includes(wire.trace), layer: wire.layer, ...layer(wire.layer), width: wire.width, a: wire.a, b: wire.b }))
  const ends = new Map<string, { layer: string; x: number; y: number; radius: number; count: number }>()
  for (const wire of traces) for (const point of [wire.a, wire.b]) {
    const key = `${wire.layer}:${point.map(n => n.toFixed(6)).join(',')}`
    const entry = ends.get(key) ?? { layer: wire.layer, x: point[0], y: point[1], radius: wire.width / 2, count: 0 }
    entry.count++
    entry.radius = Math.max(entry.radius, wire.width / 2)
    ends.set(key, entry)
  }
  const joints = [...ends.values()].filter(entry => entry.count > 1 && inside(entry.x, entry.y)).map(({ layer: name, x, y, radius }) => ({ layer: name, ...layer(name), x, y, radius }))
  const retainedPorts = new Set(circuit.filter(record => record.type === 'source_trace').filter(trace => pcbTraces.some(pcb => pcb.source_trace_id === trace.source_trace_id)).flatMap(trace => trace.connected_source_port_ids))
  const portIds = new Map(circuit.filter(record => record.type === 'pcb_port').map(port => [port.pcb_port_id, port.source_port_id]))
  const pads = circuit.filter(record => record.type === 'pcb_smtpad').filter(pad => pad.pcb_port_id && retainedPorts.has(portIds.get(pad.pcb_port_id)!)).flatMap(pad => {
    const ring: Ring = pad.shape === 'rect' ? [[pad.x - pad.width / 2, pad.y - pad.height / 2], [pad.x + pad.width / 2, pad.y - pad.height / 2], [pad.x + pad.width / 2, pad.y + pad.height / 2], [pad.x - pad.width / 2, pad.y + pad.height / 2]]
      : pad.shape === 'circle' ? Array.from({ length: 16 }, (_, i) => [pad.x + pad.radius * Math.cos(i * Math.PI / 8), pad.y + pad.radius * Math.sin(i * Math.PI / 8)] as RouteXY)
        : pad.shape === 'polygon' ? pad.points.map(point => [point.x, point.y] as RouteXY) : []
    if (!ring.length) throw new Error(`${pad.pcb_smtpad_id}: unsupported ${pad.shape} pad`)
    return ring.every(([x, y]) => inside(x, y)) ? [{ id: pad.pcb_smtpad_id, layer: pad.layer, ...layer(pad.layer), ring }] : []
  })
  // Planes run 10 mm past the region, through the absorbing boundary, so they have no edge near the net.
  const planeBox: Box = { x0: box.x0 - 10, x1: box.x1 + 10, y0: box.y0 - 10, y1: box.y1 + 10 }
  const pours = geometry.pours.flatMap(pour => pour.polygon.length ? [{ id: pour.id, net: pour.net, layer: pour.layer, ...layer(pour.layer), outer: clipRing(pour.polygon[0], planeBox),
    holes: pour.polygon.slice(1).map(ring => clipRing(ring, planeBox)).filter(ring => ring.length > 2) }] : []).filter(pour => pour.outer.length > 2)
  /** Electrical net members of a via, through its own net or its trace. */
  const viaNet = (via: typeof vias[number]): Set<string> => {
    if (via.source_net_id) return connectedSourceIds(circuit, via.source_net_id)
    const trace = circuit.filter(record => record.type === 'source_trace').find(record => record.source_trace_id === via.source_trace_id || pcbTraces.some(pcb => pcb.pcb_trace_id === via.pcb_trace_id && pcb.source_trace_id === record.source_trace_id))
    return trace ? connectedSourceIds(circuit, trace.connected_source_port_ids[0]) : new Set()
  }
  const plating = geometry.stack.viaPlatingMm ?? 0
  const modelVias = vias.filter(via => inside(via.x, via.y)).map(via => {
    const spans = via.layers.map(layer)
    const net = viaNet(via)
    // Pads on the connected end layers (nonfunctional pads omitted, as in route-transitions) and on same-net pours.
    const padLayers = [...new Set([via.layers[0], via.layers.at(-1)!, ...pours.filter(pour => net.has(pour.net) && via.layers.includes(pour.layer as typeof via.layers[number])).map(pour => pour.layer)])]
    return { id: via.pcb_via_id, selected: selectedVias.includes(via), x: via.x, y: via.y, radius: via.hole_diameter / 2 + plating, padRadius: via.outer_diameter / 2,
      zMin: Math.min(...spans.map(span => span.zMin)), zMax: Math.max(...spans.map(span => span.zMax)), padLayers, net }
  })
  // route-transitions assumes antipad = pad + 0.20 mm; every crossed other-net plane gets that clearance.
  const antipads = modelVias.flatMap(via => pours.filter(pour => !via.net.has(pour.net) && layer(pour.layer).zMin >= via.zMin - 1e-9 && layer(pour.layer).zMax <= via.zMax + 1e-9)
    .map(pour => ({ via: via.id, layer: pour.layer, x: via.x, y: via.y, radius: via.padRadius + .1, ...layer(pour.layer) })))
  const pads0 = circuit.filter(record => record.type === 'pcb_smtpad')
  const modelPorts: OpenemsPort[] = (options.openFarEnd ? ports.slice(0, 1) : ports).map(({ port, name }, i) => {
    const frame = routeContactFrame(geometry, scope, name, [port.x, port.y])!
    const references = routeReferences(geometry, { ...frame, transverse: -port.x * frame.u[1] + port.y * frame.u[0] }, port.x * frame.u[0] + port.y * frame.u[1])
    const copper = layer(name)
    const plane = references.map(ref => ({ ref, gap: ref.z <= copper.zMin ? copper.zMin - ref.z : ref.z - copper.zMax })).sort((a, b) => a.gap - b.gap)[0]
    if (!plane) throw new Error(`${port.pcb_port_id}: port has no reference plane`)
    const pad = pads0.find(entry => entry.pcb_port_id === port.pcb_port_id && entry.layer === name)
    const size = pad?.shape === 'rect' ? Math.min(pad.width, pad.height) : pad?.shape === 'circle' ? pad.radius : frame.width
    return { name: `P${i + 1}`, sourcePortId: port.source_port_id, x: port.x, y: port.y, width: size, height: size,
      zPad: plane.ref.z <= copper.zMin ? copper.zMin : copper.zMax, zPlane: plane.ref.z }
  })
  // Delay per selected-wire layer, length-weighted from the extracted self terms, places the TDR markers.
  const delay = new Map<string, { length: number; delay: number }>()
  for (const slice of extracted.slices) for (const [i, wire] of slice.wires.entries()) if (selectedTraces.includes(wire.trace)) {
    const entry = delay.get(wire.layer) ?? { length: 0, delay: 0 }
    const metres = (slice.end - slice.start) / 1000
    entry.length += metres
    entry.delay += metres * Math.sqrt(slice.line.L[i][i] * slice.line.C[i][i])
    delay.set(wire.layer, entry)
  }
  const markers: OpenemsModel['markers'] = []
  let elapsed = 0
  for (let i = 1; i < chain.length; i++) {
    const length = Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y)
    const perMetre = delay.get(chain[i].layer)
    if (!perMetre || length < 1e-6) continue
    const seconds = length / 1000 * perMetre.delay / perMetre.length
    if (length >= 8) markers.push({ label: `${chain[i].layer} run ${markers.length + 1} (${length.toFixed(1)} mm)`, roundTripSeconds: 2 * (elapsed + seconds / 2) })
    elapsed += seconds
  }
  const model: OpenemsModel = { units: 'mm', region: { ...box, zMin: bottom.zMin - materials.maskMm, zMax: top.zMax + materials.maskMm }, maximumFrequencyHz, frequencyPoints,
    copper: layers.map(entry => ({ name: entry.name, zMin: entry.zMinMm, zMax: entry.zMaxMm })), bands, traces, joints, pads, pours,
    vias: modelVias.map(({ net: _net, ...via }) => via), antipads, ports: modelPorts, markers }
  return { model, deck, extracted, warnings: [...geometry.warnings, ...transitions.warnings] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [path, seedPortId, groundId, output, distance] = process.argv.slice(2)
  if (!path || !seedPortId || !groundId || !output) throw new Error('usage: tsx scripts/openems-net.ts <circuit.json> <seed source_port_id> <ground source id> <output dir> [scope mm]')
  const circuit = JSON.parse(await readFile(path, 'utf8')) as CircuitJson
  const { model, deck, warnings } = openemsNet(circuit, { seedPortId, groundId, scopeDistanceMm: distance ? Number(distance) : undefined })
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'model.json'), JSON.stringify(model, null, 1))
  await writeFile(join(output, 'ladder.cir'), deck)
  await writeFile(join(output, 'warnings.json'), JSON.stringify(warnings, null, 1))
  console.log(`${model.traces.length} traces, ${model.vias.length} vias, ${model.pours.length} pours, ${model.ports.length} ports, ${model.markers.length} markers -> ${output}`)
}

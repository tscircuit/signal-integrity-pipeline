import type { LaneMapping, RoutedPoint } from './types'
import { fail } from '../diagnostics'

type SourcePortId = LaneMapping['from']

/** Reverse the traversal of a via along with the route. */
function reverseRoutePoint(point: RoutedPoint): RoutedPoint {
  if (point.route_type !== 'via') return point
  return { ...point, from_layer: point.to_layer, to_layer: point.from_layer }
}

/** The physical port at the chosen end of a mapping. */
function mappingPcbPort(mapping: LaneMapping, sourcePortId: SourcePortId): string {
  if (mapping.from === sourcePortId) return mapping.pcbPorts[0]
  return mapping.pcbPorts[1]
}

/** Join degree-two copper paths; retain internal pin positions for exact taps in the uniform pi model. */
export function joinSeriesMappings(mappings: LaneMapping[]): LaneMapping[] {
  const adjacent = new Map<SourcePortId, LaneMapping[]>()
  for (const mapping of mappings) for (const id of [mapping.from, mapping.to]) adjacent.set(id, [...adjacent.get(id) ?? [], mapping])
  if ([...adjacent.values()].some(edges => edges.length > 2)) fail('route_selection', 'Branched copper cannot be represented as a series channel')
  const used = new Set<LaneMapping>()
  const result: LaneMapping[] = []
  for (const seed of mappings) {
    if (used.has(seed)) continue
    const connected = new Set([seed.from])
    for (const id of connected) for (const edge of adjacent.get(id)!) {
      connected.add(edge.from)
      connected.add(edge.to)
    }
    const ends = [...connected].filter(id => adjacent.get(id)!.length === 1)
    if (ends.length !== 2) fail('route_selection', 'Closed copper cycles are unsupported')
    const start = ends.find(id => adjacent.get(id)![0].from === id) ?? ends[0]
    const parts: LaneMapping[] = []
    const route: RoutedPoint[] = []
    const taps: { sourcePortId: string; lengthMm: number }[] = []
    let end = start
    let length = 0
    for (;;) {
      const next = adjacent.get(end)!.find(edge => !used.has(edge))
      if (!next) break
      used.add(next)
      let points = next.originalRoute
      let nextEnd = next.to
      if (next.from !== end) {
        points = [...points].reverse().map(reverseRoutePoint)
        nextEnd = next.from
      }
      let skip = 0
      if (route.length) skip = 1
      route.push(...points.slice(skip))
      end = nextEnd
      parts.push(next)
      length += next.stages.reduce((sum, stage) => sum + stage.lengthMm, 0)
      if (adjacent.get(end)!.length === 2) taps.push({ sourcePortId: end, lengthMm: length })
    }
    if (parts.length === 1) {
      result.push(seed)
      continue
    }
    result.push({ ...parts[0], from: start, to: end, originalRoute: route,
      sourceTraceIds: parts.map(part => part.sourceTraceId), pcbTraceId: parts.map(part => part.pcbTraceId).join('+'),
      pcbPorts: [mappingPcbPort(parts[0], start), mappingPcbPort(parts.at(-1)!, end)],
      stages: parts.flatMap(part => part.stages), intermediatePorts: taps.map(tap => ({ sourcePortId: tap.sourcePortId, fraction: tap.lengthMm / length })) })
  }
  return result
}

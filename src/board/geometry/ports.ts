import { cju } from "@tscircuit/circuit-json-util"
import type { PcbVia } from "circuit-json"
import { fail } from "../diagnostics"
import type { CircuitJson } from "../schema"
import type { PcbTrace, PortSelector, RoutedPoint, SourcePort } from "./types"

/** Native route points and physical via records match within this distance in millimetres. */
const VIA_MATCH_DISTANCE_MM = 1e-5

/** Validated route points and the physical records that supply their via dimensions. */
interface ResolvedTraceRoute {
  route: RoutedPoint[]
  pcbViasByRouteIndex: Map<number, PcbVia>
}

/** Resolve the physical via records that supply the route via dimensions. */
export function resolveTraceRoute({
  circuit,
  trace,
}: {
  circuit: CircuitJson
  trace: PcbTrace
}): ResolvedTraceRoute {
  let vias: PcbVia[] | undefined
  const pcbViasByRouteIndex = new Map<number, PcbVia>()
  const route = trace.route.map((point, routeIndex): RoutedPoint => {
    if (point.route_type === "through_pad")
      fail("route_type", "Only wire/via routed primitives supported")
    if (point.route_type !== "via") return point
    vias ??= cju([...circuit]).pcb_via.list()
    const matches = vias.filter(
      (via) =>
        (via.pcb_trace_id === trace.pcb_trace_id ||
          (via.source_trace_id !== undefined &&
            via.source_trace_id === trace.source_trace_id)) &&
        (via.pcb_trace_id === undefined ||
          via.pcb_trace_id === trace.pcb_trace_id) &&
        (via.source_trace_id === undefined ||
          via.source_trace_id === trace.source_trace_id) &&
        via.subcircuit_id === trace.subcircuit_id &&
        Math.hypot(via.x - point.x, via.y - point.y) < VIA_MATCH_DISTANCE_MM,
    )
    if (matches.length > 1)
      fail(
        "via_geometry",
        `${trace.pcb_trace_id}: ambiguous native via at ${point.x},${point.y}`,
      )
    if (
      matches[0] &&
      (!matches[0].layers.includes(point.from_layer) ||
        !matches[0].layers.includes(point.to_layer))
    )
      fail(
        "via_geometry",
        `${trace.pcb_trace_id}: physical via layers disagree at ${point.x},${point.y}`,
      )
    const holes = [point.hole_diameter, matches[0]?.hole_diameter].filter(
      (v): v is number => v !== undefined,
    )
    if (
      !holes.length ||
      holes.some((v) => !Number.isFinite(v) || v <= 0 || v !== holes[0])
    )
      fail(
        "via_geometry",
        `${trace.pcb_trace_id}: missing, invalid or conflicting via hole diameters at ${point.x},${point.y}`,
      )
    if (matches[0]) pcbViasByRouteIndex.set(routeIndex, matches[0])
    return { ...point, hole_diameter: holes[0] }
  })
  return { route, pcbViasByRouteIndex }
}

/** Native pcbPath keeps via dimensions on the associated physical record. */
export function resolveRouteVias({
  circuit,
  trace,
}: {
  circuit: CircuitJson
  trace: PcbTrace
}): RoutedPoint[] {
  return resolveTraceRoute({ circuit, trace }).route
}

/**
 * Finds exactly one source port by id or by component name plus pin, failing 'pin_mapping' when it is
 * missing or ambiguous.
 */
export function selectPort({
  circuit,
  selector,
}: {
  circuit: CircuitJson
  selector: PortSelector | undefined
}): SourcePort {
  if (!selector)
    fail("pin_mapping", "Explicit physical source port selector required")
  const db = cju([...circuit])
  if (selector.sourcePortId) {
    const ports = db.source_port.list({ source_port_id: selector.sourcePortId })
    if (ports.length !== 1) {
      fail(
        "pin_mapping",
        `${selector.sourcePortId}: expected one source port, got ${ports.length}`,
      )
    }
    return ports[0]
  }
  const components = db.source_component.list({ name: selector.component })
  if (components.length !== 1) {
    const advice = "use sourcePortId in repeated scopes"
    fail(
      "pin_mapping",
      `${selector.component}: expected one source component, got ${components.length}; ${advice}`,
    )
  }
  const component = components[0]
  const ports = db.source_port.list().filter((port) => {
    if (port.source_component_id !== component.source_component_id) return false
    const pinName = `pin${port.pin_number}`
    return (
      port.port_hints?.includes(selector.port ?? "") ||
      port.name === selector.port ||
      pinName === selector.port
    )
  })
  if (ports.length !== 1) {
    fail(
      "pin_mapping",
      `${selector.component}.${selector.port}: expected one source port, got ${ports.length}`,
    )
  }
  return ports[0]
}

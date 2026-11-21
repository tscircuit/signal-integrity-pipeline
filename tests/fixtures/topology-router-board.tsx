import { EventEmitter } from "node:events"
import type {
  PcbTraceRoutePointVia,
  PcbTraceRoutePointWire,
  Point,
} from "circuit-json"
import { SignalPin, type TopologyBoard, topologyBoard } from "./topology-board"

/** A route point accepted by core's autorouter adapter before it emits a PCB trace. */
type RouterPoint =
  | PcbTraceRoutePointWire
  | PcbTraceRoutePointVia
  | {
      route_type: "through_obstacle"
      start: Point
      end: Point
      from_layer: "top" | "bottom"
      to_layer: "top" | "bottom"
      width: number
    }

/** Render router-only annotations and exact taper widths unsupported by manual pcbPath. */
async function routedBoard({
  route,
  receiverX = 4,
  receiverLayer = "top",
}: {
  route: RouterPoint[]
  receiverX?: number
  receiverLayer?: "top" | "bottom"
}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={receiverX} layer={receiverLayer} />
        <trace from=".TX > .SIG" to=".RX > .SIG" />
        <autoroutingphase
          algorithmFn={async ({
            connections,
          }: {
            connections: { name: string; source_trace_id?: string }[]
          }) => {
            const events = new EventEmitter()
            const [connection] = connections
            return Object.assign(events, {
              stop() {
                events.removeAllListeners()
              },
              start() {
                events.emit("complete", {
                  traces: [
                    {
                      type: "pcb_trace",
                      pcb_trace_id: "test-router-trace",
                      source_trace_id:
                        connection.source_trace_id ?? connection.name,
                      route,
                    },
                  ],
                })
              },
            })
          }}
        />
      </>
    ),
  })
}

/** The fabricated wire stops at either side of a through-pad router annotation. */
export async function throughPadGap(): Promise<TopologyBoard> {
  return routedBoard({
    route: [
      { route_type: "wire", x: -4, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
      {
        route_type: "through_obstacle",
        start: { x: -1, y: 0 },
        end: { x: 1, y: 0 },
        from_layer: "top",
        to_layer: "top",
        width: 0.1,
      },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.1 },
    ],
  })
}

/** The wide end of a teardrop reaches the receiver while its narrow end is clear. */
export async function taperedRoute({
  wideEnd,
  omitEndWidth = false,
}: {
  wideEnd: "start" | "end"
  omitEndWidth?: boolean
}): Promise<TopologyBoard> {
  const taper: PcbTraceRoutePointWire = {
    route_type: "wire",
    x: 2.8,
    y: 0.42,
    layer: "top",
    width: 0.1,
    start_width: 0.6,
    end_width: 0.1,
  }
  const end = {
    route_type: "wire",
    x: 4,
    y: 0.42,
    layer: "top",
    width: 0.1,
  } as const
  let receiverX = 2.8
  if (wideEnd === "end") {
    taper.start_width = 0.1
    taper.end_width = 0.6
    receiverX = 4
  }
  if (omitEndWidth) {
    // Older route records can carry only the starting width.
    delete taper.end_width
    receiverX = 4
  }
  return routedBoard({
    receiverX,
    route: [
      { route_type: "wire", x: -4, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 1, y: 0.42, layer: "top", width: 0.1 },
      taper,
      end,
    ],
  })
}

/** Copper stops either side of a barrel carried only by the saved route point. */
export async function routeOnlyViaRing({
  gap,
  diameterOnViaRecord = false,
}: {
  gap: number
  diameterOnViaRecord?: boolean
}): Promise<TopologyBoard> {
  const board = await routedBoard({
    receiverLayer: "bottom",
    route: [
      { route_type: "wire", x: -4, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: -gap, y: 0, layer: "top", width: 0.1 },
      {
        route_type: "through_obstacle",
        start: { x: -gap, y: 0 },
        end: { x: 0, y: 0 },
        from_layer: "top",
        to_layer: "top",
        width: 0.1,
      },
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        outer_diameter: 0.45,
      },
      {
        route_type: "through_obstacle",
        start: { x: 0, y: 0 },
        end: { x: gap, y: 0 },
        from_layer: "bottom",
        to_layer: "bottom",
        width: 0.1,
      },
      { route_type: "wire", x: gap, y: 0, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 4, y: 0, layer: "bottom", width: 0.1 },
    ],
  })
  // Core emits both encodings; saved routes may carry the dimensions in only one.
  if (diameterOnViaRecord) {
    const circuit = board.circuit.map((record) => {
      if (record.type !== "pcb_trace") return record
      const route = record.route.map((point) => {
        if (point.route_type !== "via") return point
        return { ...point, outer_diameter: undefined }
      })
      return { ...record, route }
    })
    return { ...board, circuit }
  }
  const circuit = board.circuit.filter((record) => record.type !== "pcb_via")
  return { ...board, circuit }
}

/** A saved route uses two independently located rings with copper between them. */
export async function twoRouteViaRings(): Promise<TopologyBoard> {
  const board = await routedBoard({
    route: [
      { route_type: "wire", x: -4, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: -1.2, y: 0, layer: "top", width: 0.1 },
      {
        route_type: "through_obstacle",
        start: { x: -1.2, y: 0 },
        end: { x: -1, y: 0 },
        from_layer: "top",
        to_layer: "top",
        width: 0.1,
      },
      {
        route_type: "via",
        x: -1,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        outer_diameter: 0.45,
      },
      { route_type: "wire", x: 1, y: 0, layer: "bottom", width: 0.1 },
      {
        route_type: "via",
        x: 1,
        y: 0,
        from_layer: "bottom",
        to_layer: "top",
        outer_diameter: 0.45,
      },
      {
        route_type: "through_obstacle",
        start: { x: 1, y: 0 },
        end: { x: 1.2, y: 0 },
        from_layer: "top",
        to_layer: "top",
        width: 0.1,
      },
      { route_type: "wire", x: 1.2, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.1 },
    ],
  })
  // Current core materializes these rings twice. A saved route can carry only the route points.
  return {
    ...board,
    circuit: board.circuit.filter((record) => record.type !== "pcb_via"),
  }
}

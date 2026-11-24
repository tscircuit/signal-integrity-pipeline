import log from "@stdlib/math-base-special-ln"
import { cju } from "@tscircuit/circuit-json-util"
import type { LayerRef, PcbSmtPad, PcbVia, Point } from "circuit-json"
import {
  type CircuitJson,
  type CopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  type RouteReference,
  type RouteWire,
  type RouteXY,
  resolveRouteVias,
  routeContactFrame,
  routeReferences,
  type SectionGeometry,
  type SourceNetId,
  type SourcePortId,
  sourceNetMembers,
} from "../board"
import { type Matrix, validateMatrix } from "../extraction"
import { hypotenuse, type Snapshot } from "../kernel"
import type { RouteEndpoint } from "./route-network"

/** Vacuum permittivity in farads per metre. */
const VACUUM_PERMITTIVITY = 8.8541878128e-12
/** Copper conductivity in siemens per metre. */
const COPPER_CONDUCTIVITY = 5.8e7
/** Millimetres in one metre. */
const MM_PER_METRE = 1000
/** Match via centers and layer heights within their respective tolerances (mm). */
const VIA_POSITION_TOLERANCE = 1e-5
/** Minimum separation between copper heights treated as distinct (mm). */
const LAYER_HEIGHT_TOLERANCE = 1e-6
/** Default clearance diameter increase over the copper pad (mm). */
const ANTIPAD_ALLOWANCE_MM = 0.2
/** Assumed ground stitch geometry when the board does not specify one. */
const GROUND_VIA_DISTANCE_MM = 10
/** Assumed drill diameter when no ground stitch is present. */
const GROUND_VIA_HOLE_MM = 0.15
/** Matrix validator tolerance for the line and terminal inductances. */
const TERMINAL_MATRIX_TOLERANCE = 1e-10
/** Filament-inductance scale in henries per millimetre. */
const FILAMENT_INDUCTANCE_PER_MM = 0.1e-9
/** Scale for the short via and rectangular post expressions in henries per millimetre. */
const POST_INDUCTANCE_PER_MM = 0.2e-9
/** Constant term of Grover's rectangular post self-inductance approximation. */
const RECTANGULAR_POST_OFFSET = 0.5
/** Cross-section correction in Grover's rectangular post self-inductance approximation. */
const RECTANGULAR_POST_CORRECTION = 0.2235
/** Diameter-to-radius and square-millimetre conversion in the plated annulus resistance. */
const ANNULUS_AREA_DIVISOR = 4e6
/** Aspect-ratio multiplier in the regularized short via approximation. */
const BARREL_ASPECT_MULTIPLIER = 4

/** Evidence for a stamped via or surface-mount pad. */
export interface RouteTransition {
  kind: string
  id: PcbVia["pcb_via_id"] | PcbSmtPad["pcb_smtpad_id"]
  inductanceH?: number
  capacitanceF?: number
  [key: string]: unknown
}
/** Stamps and evidence emitted by the route discontinuity models. */
export interface RouteTransitions {
  lines: string[]
  records: RouteTransition[]
  warnings: string[]
}

/** Per-end external L for explicit, equal-height vertical local-return posts (mm, H/m).
 * The PEC image doubles post length. Subtract the finite horizontal-loop end deficit
 * and the line length to the post centre. Grover's rectangular-bar self approximation
 * and the exact parallel-filament mutual introduce no fitted waveform constants.
 * This is not a BGA package model: ordinary pads and already modelled vias must not use it.
 */
export function terminalInductance({
  height,
  width,
  depth,
  positions,
  perLength,
}: {
  height: number
  width: number
  depth: number
  positions: RouteXY[]
  perLength: Matrix
}): Matrix {
  const validDimensions = [height, width, depth].every(
    (value) => Number.isFinite(value) && value > 0,
  )
  const validPositions = positions.every(
    (point) => point.length === 2 && point.every(Number.isFinite),
  )
  if (!validDimensions || !positions.length || !validPositions) {
    throw new Error(
      "Vertical terminal dimensions and positions must be finite and positive",
    )
  }
  if (perLength.length !== positions.length)
    throw new Error("Terminal and line matrix dimensions disagree")
  validateMatrix({
    a: perLength,
    name: "Terminal line L",
    tolerance: TERMINAL_MATRIX_TOLERANCE,
  })
  const matrix = positions.map((point, i) =>
    positions.map((other, j) => {
      const spacing = hypotenuse(point[0] - other[0], point[1] - other[1])
      if (i !== j && spacing < width)
        throw new Error("Vertical terminal posts overlap")
      const image = 2 * height
      const deficit =
        FILAMENT_INDUCTANCE_PER_MM * (hypotenuse(spacing, image) - spacing)
      if (i === j) {
        const self =
          POST_INDUCTANCE_PER_MM *
          height *
          (log((2 * image) / (width + depth)) +
            RECTANGULAR_POST_OFFSET +
            (RECTANGULAR_POST_CORRECTION * (width + depth)) / image)
        return self - deficit - (perLength[i][j] * depth) / (2 * MM_PER_METRE)
      }
      const mutual =
        FILAMENT_INDUCTANCE_PER_MM *
        (image * Math.asinh(image / spacing) -
          hypotenuse(image, spacing) +
          spacing)
      return mutual - deficit - (perLength[i][j] * depth) / (2 * MM_PER_METRE)
    }),
  )
  return validateMatrix({
    a: matrix,
    name: "Vertical terminal L",
    tolerance: TERMINAL_MATRIX_TOLERANCE,
  }).matrix
}

/** Regularized TI short via approximation, h/d in mm, result H; the original uses inches and 5.08 nH. */
export function barrelInductance({
  height,
  diameter,
}: {
  height: number
  diameter: number
}): number {
  return (
    POST_INDUCTANCE_PER_MM *
    height *
    (log(1 + (BARREL_ASPECT_MULTIPLIER * height) / diameter) + 1)
  )
}

/** Coaxial short open stub, with explicit assumed clearance diameter when aperture data are absent. */
export function barrelCapacitance({
  height,
  diameter,
  antipad,
  er,
}: {
  height: number
  diameter: number
  antipad: number
  er: number
}): number {
  return (
    (2 * Math.PI * VACUUM_PERMITTIVITY * er * height) /
    MM_PER_METRE /
    log(antipad / diameter)
  )
}

/** Actual pad copper area; unsupported custom polygons fail instead of disappearing. */
function padArea(pad: Snapshot<PcbSmtPad>): number {
  if (pad.shape === "circle") return Math.PI * pad.radius ** 2
  if (pad.shape === "rect") return pad.width * pad.height
  if (pad.shape === "polygon")
    return (
      Math.abs(
        pad.points.reduce((sum, p, i) => {
          const next = pad.points[(i + 1) % pad.points.length]
          return sum + p.x * next.y - next.x * p.y
        }, 0),
      ) / 2
    )
  throw new Error(`${pad.pcb_smtpad_id}: unsupported ${pad.shape} pad area`)
}

/** Copper layer mid-height in mm. */
function layerHeight({
  layers,
  name,
}: {
  layers: Snapshot<SectionGeometry["stack"]["copperLayers"]>
  name: RouteReference["layer"]
}): number {
  const layer = layers.find((layer) => layer.name === name)!
  return (layer.zMinMm + layer.zMaxMm) / 2
}

/** Average the adjacent references, falling back to the via's copper end. */
function referenceHeight({
  references,
  fallback,
}: {
  references: readonly RouteReference[]
  fallback: number
}): number {
  if (!references.length) return fallback
  return (
    references.reduce((sum, reference) => sum + reference.z, 0) /
    references.length
  )
}

/** Reference immediately adjacent to this via, rather than the first section on its layer. */
function adjacentReferences({
  wire,
  layer,
  via,
  geometry,
}: {
  wire: Snapshot<RouteWire>
  layer: LayerRef
  via: Point
  geometry: Snapshot<SectionGeometry>
}): readonly RouteReference[] {
  const slices = geometry.slices.filter((slice) => {
    return slice.wires.some(
      (candidate) =>
        candidate.trace === wire.trace && candidate.layer === layer,
    )
  })
  const candidates = slices.map((slice) => {
    const local = slice.wires.find(
      (candidate) =>
        candidate.trace === wire.trace && candidate.layer === layer,
    )!
    const position = via.x * local.u[0] + via.y * local.u[1]
    const lateral = -via.x * local.u[1] + via.y * local.u[0] - local.transverse
    const longitudinal = Math.max(
      slice.start - position,
      position - slice.end,
      0,
    )
    return { slice, distance: hypotenuse(lateral, longitudinal) }
  })
  const closest = candidates.sort((a, b) => a.distance - b.distance)[0]
  if (closest?.slice.references != null) return closest.slice.references
  const transverse = -via.x * wire.u[1] + via.y * wire.u[0]
  const position = via.x * wire.u[0] + via.y * wire.u[1]
  return routeReferences({
    geometry,
    wire: { ...wire, layer, transverse },
    position,
  })
}

/** Lumped barrels/stubs, actual pad areas and nearest physical GND-via return-loop estimates. */
export function routeTransitions({
  circuit,
  scope,
  geometry,
  endpoint,
  groundPort,
}: {
  circuit: CircuitJson
  scope: Snapshot<CopperScope>
  geometry: Snapshot<SectionGeometry>
  endpoint: RouteEndpoint
  groundPort: SourcePortId | SourceNetId
}): RouteTransitions {
  const output: RouteTransitions = { lines: [], records: [], warnings: [] }
  const layers = geometry.stack.copperLayers
  const db = cju([...circuit])
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(db.toArray())
  const ground = sourceNetMembers({ connectivity, memberId: groundPort })
  const sources = db.source_trace.list()
  const vias = db.pcb_via.list()
  const groundVias = vias.filter((via) => {
    if (via.source_net_id && ground.has(via.source_net_id)) return true
    return sources.some((source) => {
      if (source.source_trace_id !== via.source_trace_id) return false
      const ids = [
        ...source.connected_source_port_ids,
        ...(source.connected_source_net_ids ?? []),
      ]
      return ids.some((id) => ground.has(id))
    })
  })
  const traces = db.pcb_trace.list()
  for (const trace of traces) {
    const traceId = trace.pcb_trace_id
    if (
      !scope.extractedPcbTraceIds.includes(traceId) ||
      scope.nearbyRailPcbTraceIds.includes(traceId)
    )
      continue
    const wire = geometry.wires.find(
      (wire) => wire.trace === trace.pcb_trace_id,
    )
    if (!wire) continue
    const route = resolveRouteVias({ circuit, trace })
    for (const via of route.filter((point) => point.route_type === "via")) {
      const physical = vias.find((record) => {
        const matchingTrace =
          record.pcb_trace_id === traceId ||
          record.source_trace_id === trace.source_trace_id
        return (
          matchingTrace &&
          hypotenuse(via.x - record.x, via.y - record.y) <
            VIA_POSITION_TOLERANCE
        )
      })
      if (!physical)
        throw new Error(`${trace.pcb_trace_id}: missing physical via barrel`)
      const tag = `VT${output.records.length}`
      const a = endpoint({
        wire: { ...wire, layer: via.from_layer },
        point: [via.x, via.y],
      })
      const b = endpoint({
        wire: { ...wire, layer: via.to_layer },
        point: [via.x, via.y],
      })
      const fromLayerHeight = layerHeight({ layers, name: via.from_layer })
      const toLayerHeight = layerHeight({ layers, name: via.to_layer })
      const h = Math.abs(fromLayerHeight - toLayerHeight)
      const diameter = physical.hole_diameter + 2 * geometry.stack.viaPlatingMm!
      const antipad = physical.outer_diameter + ANTIPAD_ALLOWANCE_MM
      const er = geometry.stack.relativePermittivity!
      const inductanceH = barrelInductance({ height: h, diameter })
      const capacitanceF = barrelCapacitance({
        height: h,
        diameter,
        antipad,
        er,
      })
      const before = adjacentReferences({
        wire,
        layer: via.from_layer,
        via,
        geometry,
      })
      const after = adjacentReferences({
        wire,
        layer: via.to_layer,
        via,
        geometry,
      })
      const references = [...before, ...after]
      const fromHeight = referenceHeight({
        references: before,
        fallback: fromLayerHeight,
      })
      const toHeight = referenceHeight({
        references: after,
        fallback: toLayerHeight,
      })
      const padAreaMm2 = Math.max(
        0,
        (Math.PI * (physical.outer_diameter ** 2 - diameter ** 2)) / 4,
      )
      const connectedEnds = [
        { refs: before, name: via.from_layer },
        { refs: after, name: via.to_layer },
      ]
      const padCapacitanceF = connectedEnds.map(({ refs, name }) => {
        const layer = layers.find((layer) => layer.name === name)!
        return refs.reduce((sum, ref) => {
          const gap = Math.min(
            Math.abs(ref.z - layer.zMinMm),
            Math.abs(ref.z - layer.zMaxMm),
          )
          if (!(gap > LAYER_HEIGHT_TOLERANCE)) return sum
          return (
            sum + (VACUUM_PERMITTIVITY * er * padAreaMm2) / gap / MM_PER_METRE
          )
        }, 0)
      })
      const referenceLayers = [...new Set(references.map((ref) => ref.layer))]
      const candidates = groundVias
        .filter((v) => {
          const depths = v.layers.map((name) => layerHeight({ layers, name }))
          const bottom = Math.min(...depths) - LAYER_HEIGHT_TOLERANCE
          const top = Math.max(...depths) + LAYER_HEIGHT_TOLERANCE
          return referenceLayers.every((name) => {
            const height = layerHeight({ layers, name })
            return height >= bottom && height <= top
          })
        })
        .sort(
          (x, y) =>
            hypotenuse(x.x - via.x, x.y - via.y) -
            hypotenuse(y.x - via.x, y.y - via.y),
        )
      const nearest = candidates[0]
      let distance = GROUND_VIA_DISTANCE_MM
      if (nearest) distance = hypotenuse(nearest.x - via.x, nearest.y - via.y)
      const heightDifference = Math.abs(fromHeight - toHeight)
      let returnInductanceH = 0
      if (!(heightDifference < LAYER_HEIGHT_TOLERANCE)) {
        const hole = nearest?.hole_diameter ?? GROUND_VIA_HOLE_MM
        returnInductanceH =
          POST_INDUCTANCE_PER_MM *
          heightDifference *
          log(1 + (2 * distance) / hole)
      }
      const annulus = diameter ** 2 - physical.hole_diameter ** 2
      const resistance =
        h /
        MM_PER_METRE /
        ((COPPER_CONDUCTIVITY * Math.PI * annulus) / ANNULUS_AREA_DIVISOR)
      output.lines.push(
        `R${tag} ${a} ${tag}r ${resistance}`,
        `L${tag} ${tag}r ${b} ${inductanceH + returnInductanceH}`,
        `C${tag}a ${a} 0 ${capacitanceF / 2 + padCapacitanceF[0]}`,
        `C${tag}b ${b} 0 ${capacitanceF / 2 + padCapacitanceF[1]}`,
      )
      const lo = Math.min(fromLayerHeight, toLayerHeight)
      const hi = Math.max(fromLayerHeight, toLayerHeight)
      const spans = physical.layers.map((name) => layerHeight({ layers, name }))
      const stubs = [
        Math.max(0, lo - Math.min(...spans)),
        Math.max(0, Math.max(...spans) - hi),
      ]
      for (const [i, stub] of stubs.entries()) {
        if (!(stub > LAYER_HEIGHT_TOLERANCE)) continue
        const stubStart = [lo, hi][i]
        let tap = b
        if (Math.abs(fromLayerHeight - stubStart) < LAYER_HEIGHT_TOLERANCE)
          tap = a
        const inductance = barrelInductance({ height: stub, diameter })
        const capacitance = barrelCapacitance({
          height: stub,
          diameter,
          antipad,
          er,
        })
        output.lines.push(
          `L${tag}s${i} ${tap} ${tag}s${i} ${inductance}`,
          `C${tag}s${i} ${tag}s${i} 0 ${capacitance}`,
        )
      }
      output.records.push({
        kind: "via",
        id: physical.pcb_via_id,
        inductanceH,
        capacitanceF,
        returnInductanceH,
        nearestGroundVia: nearest?.pcb_via_id ?? null,
        groundViaDistanceMm: distance,
        stubsMm: stubs,
        antipadMm: antipad,
        references,
        resistanceOhm: resistance,
        padAreaMm2,
        padCapacitanceF,
      })
      if (!nearest && returnInductanceH) {
        const estimate = `return-loop estimate uses explicit ${GROUND_VIA_DISTANCE_MM} mm spreading distance`
        output.warnings.push(
          `${physical.pcb_via_id}: no spanning ground stitch found; ${estimate}`,
        )
      }
      if (references.some((ref) => !ground.has(ref.net))) {
        const assumption =
          "ideal AC rail/reference assumption omits PDN impedance"
        output.warnings.push(
          `${physical.pcb_via_id}: reference includes a different-net power plane; ${assumption}`,
        )
      }
    }
  }
  for (const port of db.pcb_port.list()) {
    const pad = db.pcb_smtpad.getWhere({ pcb_port_id: port.pcb_port_id })
    if (!pad) continue
    const wire = routeContactFrame({
      geometry,
      scope,
      layer: pad.layer,
      point: [port.x, port.y],
    })
    if (!wire) continue
    const position = port.x * wire.u[0] + port.y * wire.u[1]
    const references = routeReferences({
      geometry,
      wire: { ...wire, transverse: -port.x * wire.u[1] + port.y * wire.u[0] },
      position,
    })
    const layer = layers.find((layer) => layer.name === wire.layer)!
    const area = padArea(pad)
    const gaps = references.map((plane) =>
      Math.min(
        Math.abs(plane.z - layer.zMinMm),
        Math.abs(plane.z - layer.zMaxMm),
      ),
    )
    const gap = Math.min(...gaps)
    if (!(area > 0 && gap > 0 && Number.isFinite(gap))) {
      throw new Error(`${pad.pcb_smtpad_id}: invalid pad/reference geometry`)
    }
    const capacitanceF =
      (VACUUM_PERMITTIVITY * geometry.stack.relativePermittivity! * area) /
      gap /
      MM_PER_METRE
    output.lines.push(
      `CPAD${output.records.length} ${endpoint({ wire, point: [port.x, port.y] })} 0 ${capacitanceF}`,
    )
    output.records.push({
      kind: "pad",
      id: pad.pcb_smtpad_id,
      capacitanceF,
      areaMm2: area,
      gapMm: gap,
    })
  }
  output.warnings.push(
    [
      "Via-to-via and via-to-trace mutual coupling is omitted;",
      "barrel models contain self L/C and a signal-referred return estimate.",
    ].join(" "),
    [
      "Via pads use connected-end annular parallel-plate capacitance;",
      "nonfunctional internal pads are unspecified and omitted. Antipad edge fringing is not resolved.",
    ].join(" "),
    [
      "Via antipads: outer pad diameter + 0.20 mm assumed;",
      "barrel coaxial C and short-open-stub LC are estimates, not 3D discontinuity extraction.",
    ].join(" "),
    [
      "Return-loop L is signal-referred at the via;",
      "ideal equipotential planes omit shared plane spreading resonances and PDN impedance.",
    ].join(" "),
    [
      "BGA/SMD pads use parallel-plate area capacitance;",
      "routed breakout wire R/L remains distributed. Pad fringing and current crowding are omitted.",
    ].join(" "),
  )
  return output
}

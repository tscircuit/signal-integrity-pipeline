import { cju } from "@tscircuit/circuit-json-util"
import type { Snapshot } from "../kernel"
import { getSourcePortConnectivityMapFromCircuitJson } from "./connectivity"
import { resolvePadContacts } from "./copper-geometry-contacts"
import { MAX_REFERENCE_EDGE_DISTANCE_MM } from "./copper-geometry-reference-range"
import { normalizeReferencePour } from "./copper-geometry-references"
import { simplifyWires } from "./copper-geometry-simplify"
import { sweepWireSections } from "./copper-geometry-sweep"
import { extractTraceWires } from "./copper-geometry-traces"
import type {
  CopperVia,
  ExtractedCopper,
  TraceWire,
} from "./copper-geometry-types"
import { unionWires } from "./copper-geometry-union"
import { collectCopperVias, readCopperVia } from "./copper-geometry-vias"
import type { CopperScope } from "./geometry/scope"
import type { CircuitJson } from "./schema"
import { stackupFromCircuitJson } from "./stackup"

/** One micrometre limits chord deviation below ordinary copper feature tolerances. */
const CHORD_TOLERANCE_MM = 0.001

/** Board records and the copper scope selected for extraction. */
interface CopperGeometryExtractionOptions {
  circuit: CircuitJson
  copperScope: Snapshot<CopperScope>
}

/** Work completed before computing sections and contacts. */
export interface CopperGeometryExtractionProgress {
  traces: number
  wires: number
}

/** Simplify and union the wires before computing electrical contacts and references. */
function finalizeGeometry({
  circuit,
  copperScope,
  wires,
  embeddedVias,
}: CopperGeometryExtractionOptions & {
  wires: TraceWire[]
  embeddedVias: CopperVia[]
}): ExtractedCopper {
  const db = cju([...circuit])
  const stackup = stackupFromCircuitJson(circuit)
  const pours = db.pcb_copper_pour.list().flatMap((pour) => {
    if (
      !copperScope.referencePcbCopperPourIds.includes(pour.pcb_copper_pour_id)
    )
      return []
    return normalizeReferencePour(pour)
  })
  const scopedVias = db.pcb_via
    .list()
    .filter((via) => copperScope.extractedPcbViaIds.includes(via.pcb_via_id))
    .map(readCopperVia)
  const board = db.pcb_board.get(stackup.pcbBoardId)
  const vias = collectCopperVias({
    scopedVias,
    embeddedVias,
    boardLayers: stackup.copperLayers.map(({ name }) => name).reverse(),
    allowsBlindVias: board?.allow_blind_and_buried_vias === true,
  })
  const simplified = simplifyWires({
    wires,
    toleranceMm: CHORD_TOLERANCE_MM,
  })
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const mergedWires = unionWires({
    chords: simplified.chords,
    db,
    connectivity,
  })
  const contacts = resolvePadContacts({
    db,
    connectivity,
    chords: simplified.chords,
    mergedWires,
    vias,
    copperScope,
  })
  const geometry = { ...contacts, stackup, pours, vias }
  return {
    ...geometry,
    sections: sweepWireSections({ geometry, copperScope }),
    warnings: [
      `Chord tolerance ${CHORD_TOLERANCE_MM} mm reduced ${wires.length} wires to ${simplified.chords.length}. Total length changed from ${simplified.originalLengthMm} to ${simplified.simplifiedLengthMm} mm.`,
      "Overlapping parallel same-net wires share one copper rectangle. The original endpoints join its centerline through ideal connections.",
      `When no reference lies above or below a wire, a pour edge within ${MAX_REFERENCE_EDGE_DISTANCE_MM} mm supplies an effective reference surface. The distance combines the vertical gap and lateral gap.`,
      "Wires with different directions are sectioned independently.",
    ],
  }
}

/** Extract one trace per step and report counts independent of the working geometry. */
export function* stepCopperGeometryExtraction({
  circuit,
  copperScope,
}: CopperGeometryExtractionOptions): Generator<
  CopperGeometryExtractionProgress,
  ExtractedCopper
> {
  const db = cju([...circuit])
  const wires: TraceWire[] = []
  const embeddedVias: CopperVia[] = []
  const traces = db.pcb_trace
    .list()
    .filter((trace) =>
      copperScope.extractedPcbTraceIds.includes(trace.pcb_trace_id),
    )
  for (const [index, trace] of traces.entries()) {
    const extracted = extractTraceWires({
      circuit,
      trace,
      firstWireIndex: wires.length,
    })
    wires.push(...extracted.wires)
    embeddedVias.push(...extracted.vias)
    yield { traces: index + 1, wires: wires.length }
  }
  return finalizeGeometry({ circuit, copperScope, wires, embeddedVias })
}

/** Extract copper geometry synchronously when incremental progress is unnecessary. */
export function extractCopperGeometry(
  options: CopperGeometryExtractionOptions,
): ExtractedCopper {
  const steps = stepCopperGeometryExtraction(options)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

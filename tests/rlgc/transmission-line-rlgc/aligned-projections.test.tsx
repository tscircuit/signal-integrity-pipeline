import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import {
  channelCopperScope,
  extractCopperGeometry,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../../src/board"
import { buildCrossSection, calculateRlgc } from "../../../src/rlgc"
import { AlignedEdges } from "../../fixtures/aligned-edges"
import { renderCoreSignals } from "../../support/core-render"

test("coalesces aligned conductor projections", async () => {
  const circuit = await renderCoreSignals(<AlignedEdges />)
  const db = cju(circuit)
  const groundSourceNet = db.source_net.getWhere({ name: "GND" })
  assert(groundSourceNet)
  const sourceTraces = db.source_trace.list()
  const channelSourcePortIds = new Set(
    sourceTraces.flatMap((trace) => trace.connected_source_port_ids),
  )
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const scope = channelCopperScope({
    circuit,
    connectivity,
    channelSourceIds: channelSourcePortIds,
    referenceSourceIds: sourceNetMembers({
      connectivity,
      memberId: groundSourceNet.source_net_id,
    }),
    railSourceIds: new Set(),
    distanceMm: 1,
  })
  const geometry = extractCopperGeometry({ circuit, copperScope: scope })
  const wireSection = geometry.sections.find(
    (section) =>
      section.wires.length === 2 &&
      section.wires.every((wire) => wire.direction[1] === 1),
  )
  assert.ok(wireSection)
  const materials = {
    maskThicknessMm: 0.02,
    maskRelativePermittivity: 3.3,
    maskLossTangent: 0.025,
    laminateLossTangent: 0.02,
  }
  const aligned = buildCrossSection({ geometry, wireSection, materials })
  const alignedMatrices = calculateRlgc({ crossSection: aligned })
  const mirrored = calculateRlgc({
    crossSection: {
      ...aligned,
      conductors: aligned.conductors.map((conductor) => ({
        ...conductor,
        xMm: -conductor.xMm,
      })),
    },
  })
  for (const kind of [
    "capacitanceFaradsPerMeter",
    "vacuumCapacitanceFaradsPerMeter",
    "externalInductanceHenriesPerMeter",
  ] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const relativeError = Math.abs(
          alignedMatrices[kind][i][j] / mirrored[kind][i][j] - 1,
        )
        assert.ok(relativeError < 1e-7, `${kind} respects physical reflection`)
      }
    }
  }
})

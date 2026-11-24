import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import {
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../../src/board"
import {
  buildCrossSection,
  TransmissionLineRlgcSolver,
} from "../../../src/rlgc"
import { drawCrossSection } from "../../fixtures/cross-section-drawing"
import { assertPlanDrawingSnapshot } from "../../fixtures/plan-drawing-snapshot"
import ReturnAgreement from "../../fixtures/return-agreement"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"
import { renderCoreSignals } from "../../support/core-render"

test("draws the soldermask and laminate used by a coupled wire pair", async () => {
  const circuitJson = await renderCoreSignals(<ReturnAgreement count={2} />)
  const db = cju(circuitJson)
  const groundSourceNet = db.source_net.getWhere({ name: "GND" })
  assert(groundSourceNet)
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuitJson)
  const copperScope = channelCopperScope({
    circuit: circuitJson,
    connectivity,
    channelSourceIds: new Set(
      db.source_trace
        .list()
        .flatMap((trace) => trace.connected_source_port_ids),
    ),
    referenceSourceIds: sourceNetMembers({
      connectivity,
      memberId: groundSourceNet.source_net_id,
    }),
    railSourceIds: new Set(),
    distanceMm: 1,
  })
  const copperGeometry = solveBoardCopperGeometry({ circuitJson, copperScope })
  const solver = new TransmissionLineRlgcSolver({
    copperGeometry,
    artifactPrefix: "test",
  })
  solver.solve()
  const { solvedWireSections } = solver.getOutput().value
  assert.equal(solvedWireSections.length, 1)
  const crossSection = buildCrossSection({
    geometry: copperGeometry.geometry,
    wireSection: solvedWireSections[0],
    materials: solver.materials,
  })
  assert.equal(crossSection.conductors.length, 2)
  assertPlanDrawingSnapshot({
    module: "rlgc",
    name: "coupled-pair-soldermask",
    drawing: drawCrossSection({
      crossSection,
      halfWidthMm: 1.2,
      title: "Coupled wire pair · laminate and soldermask",
    }),
    trimTrailingWhitespace: true,
  })
})

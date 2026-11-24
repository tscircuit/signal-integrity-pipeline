import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import {
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  sourceNetMembers,
} from "../../../src/board"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import ReturnAgreement from "../../fixtures/return-agreement"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"
import { renderCoreSignals } from "../../support/core-render"

test("screens pairs by electric and magnetic coupling", async () => {
  const materials = {
    maskThicknessMm: 0,
    maskRelativePermittivity: 1,
    maskLossTangent: 0,
    laminateLossTangent: 0,
  }
  const cases = [
    {
      spacingMm: 0.3,
      thicknessMm: 0.4,
      groups: [[0, 1, 2]],
      decisions: [true, true, true],
    },
    {
      spacingMm: 16,
      thicknessMm: 0.4,
      groups: [[0], [1], [2]],
      decisions: [false, false, false],
    },
    {
      spacingMm: 4,
      thicknessMm: 1.6,
      groups: [[0, 1, 2]],
      decisions: [true, true, true],
    },
    {
      spacingMm: 3,
      thicknessMm: 0.4,
      groups: [[0, 1, 2]],
      decisions: [true, false, true],
    },
  ]
  for (const { spacingMm, thicknessMm, groups, decisions } of cases) {
    const circuit = await renderCoreSignals(
      <ReturnAgreement spacingMm={spacingMm} thicknessMm={thicknessMm} />,
    )
    const db = cju(circuit)
    const sourceTraces = db.source_trace.list()
    const twoPortTraces = sourceTraces.filter(
      (trace) => trace.connected_source_port_ids.length === 2,
    )
    const channelSourcePortIds = new Set(
      twoPortTraces.flatMap((trace) => trace.connected_source_port_ids),
    )
    const groundSourceNet = db.source_net.getWhere({ name: "GND" })
    assert(groundSourceNet)
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
      distanceMm: 32,
    })
    const copperGeometry = solveBoardCopperGeometry({
      circuitJson: circuit,
      copperScope: scope,
    })
    const solver = new TransmissionLineRlgcSolver({
      copperGeometry,
      materials,
      artifactPrefix: "test",
    })
    solver.solve()
    const { solvedWireSections, pairCouplings, crossSectionSolutions } =
      solver.getOutput().value
    assert.deepEqual(
      solvedWireSections.map(({ wires }) =>
        wires.map(({ wireIndex }) => wireIndex),
      ),
      groups,
    )
    assert.deepEqual(
      pairCouplings.map(({ wireIndices }) => wireIndices),
      [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
    )
    assert.deepEqual(
      pairCouplings.map(({ isCoupled }) => isCoupled),
      decisions,
    )
    assert.deepEqual(
      new Set(
        crossSectionSolutions.map(({ crossSectionKey }) => crossSectionKey),
      ),
      new Set(solvedWireSections.map(({ crossSectionKey }) => crossSectionKey)),
    )
  }
})

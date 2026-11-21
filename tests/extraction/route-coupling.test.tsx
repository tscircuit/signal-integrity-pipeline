import { test } from "bun:test"
import assert from "node:assert/strict"
import React from "react"
import {
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  segmentRoutes,
  sourceNetMembers,
} from "../../src/board"
import { RouteFieldsSolver } from "../../src/extraction"
import Board from "../fixtures/return-agreement"
import { renderCoreSignals } from "../support/core-render"

test("screens pairs by electric and magnetic coupling", async () => {
  const materials = {
    maskMm: 0,
    maskEr: 1,
    maskLoss: 0,
    substrateLoss: 0,
  }
  const cases = [
    { spacing: 0.3, thickness: 0.4, groupSize: 3 },
    { spacing: 16, thickness: 0.4, groupSize: 1 },
    { spacing: 4, thickness: 1.6, groupSize: 3 },
  ]
  for (const { spacing, thickness, groupSize } of cases) {
    const circuit = await renderCoreSignals(
      <Board spacing={spacing} thickness={thickness} />,
    )
    const traces = circuit.filter((record) => record.type === "source_trace")
    const twoPortTraces = traces.filter(
      (trace) => trace.connected_source_port_ids.length === 2,
    )
    const selected = new Set(
      twoPortTraces.flatMap((trace) => trace.connected_source_port_ids),
    )
    const ground = circuit
      .filter((record) => record.type === "source_net")
      .find((net) => net.name === "GND")!
    const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
    const scope = channelCopperScope({
      circuit,
      connectivity,
      selected,
      reference: sourceNetMembers({ connectivity, seed: ground.source_net_id }),
      rails: new Set(),
      distanceMm: 32,
    })
    const geometry = segmentRoutes({ circuit, scope })
    const solver = new RouteFieldsSolver({
      geometry,
      materials,
      artifactPrefix: "test",
    })
    solver.solve()
    const { slices } = solver.getOutput().value
    assert.equal(
      Math.max(...slices.map((slice) => slice.wires.length)),
      groupSize,
      "Nearby wires stay coupled; distant wires split only after both normalized mutuals fall below 0.5%",
    )
  }
})

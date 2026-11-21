import { test } from "bun:test"
import assert from "node:assert/strict"
import React from "react"
import {
  channelCopperScope,
  getSourcePortConnectivityMapFromCircuitJson,
  segmentRoutes,
  sourceNetMembers,
} from "../../src/board"
import { routeCrossSection, solveCrossSection } from "../../src/extraction"
import { AlignedEdges } from "../fixtures/aligned-edges"
import { sectionFixture } from "../fixtures/cross-section"
import { renderCoreSignals } from "../support/core-render"

const section = sectionFixture({ kind: "mask", count: 2 })

test("reflects an upper reference plane", () => {
  const original = solveCrossSection({ section })
  const reflected = solveCrossSection({
    section: {
      conductors: section.conductors.map((c) => ({
        ...c,
        zMm: -c.zMm - c.thicknessMm,
      })),
      planes: section.planes,
      dielectrics: section.dielectrics.map((d) => ({
        ...d,
        zMm: -d.zMm - d.thicknessMm,
      })),
    },
  })
  for (const key of ["C", "L"] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(original[key][i][j] / reflected[key][i][j] - 1) < 1e-8,
        )
      }
    }
  }
})

test("isolates fields across a plane", () => {
  const shielded = solveCrossSection({
    section: {
      ...section,
      conductors: [
        section.conductors[0],
        { ...section.conductors[1], zMm: -1.035 },
      ],
      dielectrics: [],
    },
  })
  for (const matrix of [
    shielded.C,
    shielded.C0,
    shielded.L,
    shielded.skinResistance,
    shielded.dielectricLoss,
  ]) {
    assert.equal(matrix[0][1], 0)
  }
})

test("preserves conductor ordering", () => {
  const original = solveCrossSection({ section })
  const permuted = solveCrossSection({
    section: { ...section, conductors: [...section.conductors].reverse() },
  })
  for (const key of [
    "C",
    "C0",
    "L",
    "skinResistance",
    "dielectricLoss",
  ] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        assert.ok(
          Math.abs(original[key][i][j] / permuted[key][1 - i][1 - j] - 1) <
            1e-8,
        )
      }
    }
  }
})

test("limits recession across a narrow gap", () => {
  const close = solveCrossSection({
    section: {
      conductors: [
        {
          id: "a",
          xMm: 0,
          zMm: 0.1,
          widthMm: 0.1,
          thicknessMm: 0.035,
        },
        {
          id: "b",
          xMm: 0.1002,
          zMm: 0.1,
          widthMm: 0.1,
          thicknessMm: 0.035,
        },
      ],
      planes: [{ zMm: 0 }],
      dielectrics: [],
    },
  })
  assert.ok(close.diagnostics.recessionMm < 0.0002 / 4)
})

test("requires a reference plane", () => {
  assert.throws(
    () => solveCrossSection({ section: { ...section, planes: [] } }),
    { code: "native_geometry" },
  )
})

test("rejects a flat conductor", () => {
  const flat = [{ ...section.conductors[0], thicknessMm: 0 }]
  assert.throws(
    () => solveCrossSection({ section: { ...section, conductors: flat } }),
    { code: "native_geometry" },
  )
})

test("rejects a conductor touching a plane", () => {
  const touchingPlane = [{ ...section.conductors[0], zMm: 0 }]
  assert.throws(
    () =>
      solveCrossSection({ section: { ...section, conductors: touchingPlane } }),
    { code: "native_geometry" },
  )
})

test("rejects duplicate conductor IDs", () => {
  const duplicates = [section.conductors[0], section.conductors[0]]
  assert.throws(
    () =>
      solveCrossSection({ section: { ...section, conductors: duplicates } }),
    { code: "native_geometry" },
  )
})

test("rejects overlapping slabs", () => {
  const overlappingSlabs = [...section.dielectrics, section.dielectrics[0]]
  assert.throws(
    () =>
      solveCrossSection({
        section: { ...section, dielectrics: overlappingSlabs },
      }),
    { code: "native_geometry" },
  )
})

test("requires enough panels per edge", () => {
  assert.throws(
    () => solveCrossSection({ section, options: { panelsPerEdge: 1 } }),
    { code: "mesh_convergence" },
  )
})

test("coalesces aligned conductor projections", async () => {
  const circuit = await renderCoreSignals(<AlignedEdges />)
  const ground = circuit
    .filter((record) => record.type === "source_net")
    .find((net) => net.name === "GND")!
  const traces = circuit.filter((record) => record.type === "source_trace")
  const selected = new Set(
    traces.flatMap((trace) => trace.connected_source_port_ids),
  )
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const scope = channelCopperScope({
    circuit,
    connectivity,
    selected,
    reference: sourceNetMembers({ connectivity, seed: ground.source_net_id }),
    rails: new Set(),
    distanceMm: 1,
  })
  const geometry = segmentRoutes({ circuit, scope })
  const slice = geometry.slices.find(
    (slice) =>
      slice.wires.length === 2 && slice.wires.every((wire) => wire.u[1] === 1),
  )!
  assert.ok(slice)
  const materials = {
    maskMm: 0.02,
    maskEr: 3.3,
    maskLoss: 0.025,
    substrateLoss: 0.02,
  }
  const aligned = routeCrossSection({ geometry, slice, materials })
  const line = solveCrossSection({ section: aligned })
  const mirrored = solveCrossSection({
    section: {
      ...aligned,
      conductors: aligned.conductors.map((conductor) => ({
        ...conductor,
        xMm: -conductor.xMm,
      })),
    },
  })
  for (const kind of ["C", "C0", "L"] as const) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const relativeError = Math.abs(
          line[kind][i][j] / mirrored[kind][i][j] - 1,
        )
        assert.ok(relativeError < 1e-7, `${kind} respects physical reflection`)
      }
    }
  }
})

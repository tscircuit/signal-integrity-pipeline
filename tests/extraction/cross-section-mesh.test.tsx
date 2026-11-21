import { test } from "bun:test"
import assert from "node:assert/strict"
import { solveCrossSection } from "../../src/extraction"
import { sectionFixture } from "../fixtures/cross-section"

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

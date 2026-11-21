import { test } from "bun:test"
import assert from "node:assert/strict"
import { segmentRoutes } from "../../src/board"
import {
  type RouteFieldsInput,
  RouteFieldsSolver,
  routeCrossSection,
  solveCrossSection,
} from "../../src/extraction"
import { routedCopper } from "../fixtures/routed-copper"

/** Input shared by the field solver tests. */
async function fieldsInput(): Promise<RouteFieldsInput> {
  const { circuitJson, scope } = await routedCopper()
  const geometry = segmentRoutes({ circuit: circuitJson, scope })
  const materials = {
    maskMm: 0.02,
    maskEr: 3.3,
    maskLoss: 0.025,
    substrateLoss: 0.02,
  }
  return { geometry, materials, artifactPrefix: "test" }
}

test("reuses canonical pair geometry", async () => {
  const solver = new RouteFieldsSolver(await fieldsInput())
  solver.step()
  assert.equal(solver.solved, false)
  assert.equal(solver.stats.uniqueSolves, 1)
  solver.solve()
  const result = solver.getOutput()
  assert.equal(result.value.sections.length, 1)
  assert.equal(solver.stats.cacheHits, 1)
})

test("publishes frozen coefficients matching direct extraction", async () => {
  const input = await fieldsInput()
  const { geometry } = input
  const solver = new RouteFieldsSolver(input)
  solver.solve()
  const result = solver.getOutput()
  const section = routeCrossSection({
    geometry,
    slice: geometry.slices[0],
    materials: solver.materials,
  })
  const direct = solveCrossSection({ section, options: { panelsPerEdge: 12 } })
  assert.deepEqual(result.value.slices[0].line.C, direct.C)
  assert.ok(solver.visualize().rects!.length > 2)
  assert.ok(Object.isFrozen(result.value.slices[0].line.C))
})

test("replays extraction from serialized constructor parameters", async () => {
  const solver = new RouteFieldsSolver(await fieldsInput())
  solver.solve()
  const result = solver.getOutput()
  const repeat = new RouteFieldsSolver(
    JSON.parse(JSON.stringify(solver.getConstructorParams()[0])),
  )
  repeat.solve()
  assert.deepEqual(repeat.getOutput().artifacts, result.artifacts)
})

test("caps the number of screened conductors", async () => {
  const { geometry } = await fieldsInput()
  const invalid = new RouteFieldsSolver({
    geometry: {
      ...geometry,
      slices: [
        { ...geometry.slices[0], wires: Array(41).fill(geometry.wires[0]) },
      ],
    },
    artifactPrefix: "test",
  })
  assert.throws(() => invalid.solve(), /limit of 40/)
})

import { routeTones } from "../../src/board"
import {
  assertRouteVisual,
  routedVisualFixture,
} from "../fixtures/routed-visual"

test("two-trace TSX route-fields-solver visual SVG snapshot", async () => {
  const { root } = await routedVisualFixture()
  assertRouteVisual({
    drawing: root
      .getSolver<RouteFieldsSolver>("RouteFieldsSolver")!
      .visualize(),
    module: "extraction",
    name: "route-fields-solver",
  })
})

/** Check the whole-ohm label used for mapped copper. */
function isImpedanceLabel(label: string): boolean {
  const suffix = " Ω"
  if (!label.endsWith(suffix)) return false
  const value = label.slice(0, -suffix.length)
  return (
    value.length > 0 && [...value].every((char) => char >= "0" && char <= "9")
  )
}

test("field drawing cuts the board at the slice and shows its stack in a pane, writing only Z0", async () => {
  const { root } = await routedVisualFixture()
  const drawing = root
    .getSolver<RouteFieldsSolver>("RouteFieldsSolver")!
    .visualize()
  assert.ok(
    drawing.polygons!.some((polygon) => polygon.fill === routeTones.slice),
    "amber cut on the board",
  )
  assert.ok(
    drawing.lines!.some(
      (line) => line.zIndex === -1 && line.strokeColor === routeTones.pane,
    ),
    "the pane is opaque over the board",
  )
  const mapped = drawing.lines!.filter((line) =>
    isImpedanceLabel(line.label ?? ""),
  )
  assert.ok(
    mapped.length >= 2 &&
      mapped.every((line) => line.strokeColor!.startsWith("rgb(")),
    "solved copper is coloured by its Z0",
  )
  assert.equal(
    drawing.rects!.filter(
      (rect) => rect.fill?.startsWith("rgb(") && rect.width < 1,
    ).length >= 2,
    true,
    "conductors share the Z0 scale",
  )
  assert.ok(
    drawing.polygons!.some((polygon) => polygon.fill === routeTones.coupling),
    "coupling band paints in front of the stack",
  )
  assert.ok(
    drawing.texts!.every((text) => /^\d+ Ω$/.test(text.text)),
    "only impedances are written",
  )
})

import {
  energyFacts,
  hasNonnegativeLoss,
  isGroundedMaxwell,
  isPositiveDefinite,
  maxwellFacts,
} from "../support/golden-checks"

test("golden invariants: every routed TSX section has SPD L/C with |k| < 1, Maxwell C and PSD R/G", async () => {
  // Passive reciprocal multiconductor lines (Paul, Analysis of Multiconductor Transmission Lines, 2nd ed.,
  // sections 3.2–3.4): L and C symmetric positive definite, every pairwise |k| < 1; grounded Maxwell C has a
  // positive diagonal, non-positive off-diagonal entries (zero only across shielding planes) and non-negative row
  // sums. R(f) = R_dc + congruence(sqrt(f) R_skin) and G(f) = 2 pi f D are PSD iff R_dc, R_skin and D are PSD.
  // Tolerances are floating point only: asymmetry 1e-12, row sums >= -1e-9 C_ii, PSD eigenvalues >= -1e-12 of
  // the largest.
  const { circuitJson, scope } = await routedCopper()
  const copper = new RouteFieldsSolver({
    geometry: segmentRoutes({
      circuit: circuitJson,
      scope,
    }),
    artifactPrefix: "golden",
  })
  copper.solve()
  const { root } = await routedVisualFixture()
  const sections = [
    ...copper
      .getOutput()
      .value.sections.map((section) => ({ board: "routedCopper", ...section })),
    ...root.stageOutput("RouteFieldsSolver").value.flatMap((extracted) =>
      extracted.sections.map((section) => ({
        board: "TwoTraceBoard",
        ...section,
      })),
    ),
  ]
  const rows: Record<string, number | string>[] = []
  const failures: string[] = []
  for (const { board, key, line } of sections) {
    const label = `${board} ${key.slice(0, 40)}`
    let coupling = 0
    let minimum = Infinity
    for (const [name, matrix] of [
      ["L", line.L],
      ["C", line.C],
      ["C0", line.C0],
    ] as const) {
      const facts = energyFacts(matrix.map((row) => [...row]))
      coupling = Math.max(coupling, facts.coupling)
      minimum = Math.min(
        minimum,
        facts.minimumEigenvalue / facts.maximumEigenvalue,
      )
      if (!isPositiveDefinite(facts))
        failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    const maxwell = maxwellFacts(line.C.map((row) => [...row]))
    if (!isGroundedMaxwell({ facts: maxwell }))
      failures.push(`${label} Maxwell: ${JSON.stringify(maxwell)}`)
    const lossMatrices = [
      ["R_dc", line.dcResistance],
      ["R_skin", line.skinResistance],
      ["D", line.dielectricLoss],
    ] as const
    for (const [name, matrix] of lossMatrices) {
      const facts = energyFacts(matrix.map((row) => [...row]))
      if (!hasNonnegativeLoss({ matrix, facts }))
        failures.push(`${label} ${name}: ${JSON.stringify(facts)}`)
    }
    rows.push({
      section: label,
      conductors: line.L.length,
      smallestEigenvalueRatio: +minimum.toExponential(3),
      largestCouplingK: +coupling.toFixed(4),
    })
  }
  console.table(rows)
  assert.ok(sections.length >= 2, "both routed boards produced sections")
  assert.deepEqual(failures, [])
})

import { test } from "bun:test"
import assert from "node:assert/strict"
import { type RouteWire, type RouteXY, segmentRoutes } from "../../src/board"
import { RouteFieldsSolver } from "../../src/extraction"
import {
  type RouteLadder,
  routeLadder,
} from "../../src/simulation/route-ladder"
import { routedCopper } from "../support/routed-fixture"

/** Electrical identity follows physical TSX copper endpoints. */
function endpoint(wire: RouteWire, point: RouteXY): string {
  const coordinates = point.map((value) => value.toFixed(8)).join("_")
  return `${wire.layer}_${coordinates}`
}

test("actual routed TSX exceeds the old 1024-cell cap with locally supported coupling", async () => {
  const { circuitJson, scope } = await routedCopper()
  const fields = new RouteFieldsSolver({
    geometry: segmentRoutes(circuitJson, scope),
    artifactPrefix: "test",
  })
  fields.solve()
  const result = routeLadder({
    extracted: fields.getOutput().value,
    endpoint,
    riseSeconds: 1e-12,
  })
  assert.ok(result.cells > 1024)
  const couplings = result.lines.filter((line) => line.startsWith("K"))
  assert.ok(couplings.length > 0)
  assert.ok(
    couplings.length < result.cells * 30,
    "fixed-width local slices scale with cell count",
  )
  const coupled = result.lines.some((line) => line.startsWith("GARCS"))
  assert.ok(coupled, "actual TSX copper exercises coupled Foster resistance")
  assert.equal(
    result.lines.filter(
      (line) => line.startsWith("VARCS") || line.startsWith("HARCS"),
    ).length,
    0,
    "tiny Foster voltages must not be differences along sensor/CCVS chains",
  )
  const resistance = result.lines.filter((line) => line.startsWith("RARCS"))
  assert.ok(
    resistance.every(
      (line) => line.split(" ")[2] !== "0" || line.endsWith(" 1"),
    ),
    "coupled resistance equations have unit diagonal",
  )
})

// ---- Golden known-answer checks for stages 5–6 (docs/golden-checks.md). The ladder is the lowest layer that
// builds a plain line: straight parallel wires get the solved per-unit-length matrices of one cross-section.
// Expected values and tolerances are fixed from transmission-line theory before ngspice runs.

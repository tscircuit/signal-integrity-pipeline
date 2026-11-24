import { beforeAll, describe, setDefaultTimeout, test } from "bun:test"
import assert from "node:assert/strict"
import type { CopperPoint, TraceWire } from "../../src/board"
import type { Snapshot } from "../../src/kernel"
import { TransmissionLineRlgcSolver } from "../../src/rlgc"
import {
  type RouteLadder,
  routeLadder,
} from "../../src/simulation/route-ladder"
import { renderRoutedCopper } from "../fixtures/routed-copper"
import { solveBoardCopperGeometry } from "../fixtures/transmission-line-rlgc"

setDefaultTimeout(150_000)

/** Retain submicrometre distinctions in stamped endpoint names. */
const COORDINATE_PRECISION = 8

/** Electrical identity follows physical TSX copper endpoints. */
function endpoint({
  wire,
  point,
}: {
  wire: Snapshot<TraceWire>
  point: Snapshot<CopperPoint>
}): string {
  const coordinates = point
    .map((value) => value.toFixed(COORDINATE_PRECISION))
    .join("_")
  return `${wire.layer}_${coordinates}`
}

describe("large routed TSX ladder", () => {
  let result: RouteLadder

  beforeAll(async () => {
    const { circuitJson, copperScope: scope } = await renderRoutedCopper()
    const fields = new TransmissionLineRlgcSolver({
      copperGeometry: solveBoardCopperGeometry({
        circuitJson,
        copperScope: scope,
      }),
      artifactPrefix: "test",
    })
    fields.solve()
    result = routeLadder({
      extracted: fields.getOutput().value,
      endpoint,
      riseSeconds: 1e-12,
    })
  })

  test("assembles more than 1024 cells", () => {
    assert.ok(result.cells > 1024)
  })

  test("limits mutual terms to nearby cells", () => {
    const couplings = result.lines.filter((line) => line.startsWith("K"))
    assert.ok(couplings.length > 0)
    assert.ok(
      couplings.length < result.cells * 30,
      "fixed-width local slices scale with cell count",
    )
  })

  test("stamps normalized Foster resistance", () => {
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
})

// ---- Golden known-answer checks for stages 5–6 (docs/golden-checks.md). The ladder is the lowest layer that
// builds a plain line: straight parallel wires get the solved per-unit-length matrices of one cross-section.
// Expected values and tolerances are fixed from transmission-line theory before ngspice runs.

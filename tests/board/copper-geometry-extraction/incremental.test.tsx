import { test } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import { CopperGeometryExtractionSolver } from "../../../src/board"
import { renderRoutedCopper } from "../../fixtures/routed-copper"

test("stops after one trace per step and publishes the extracted copper geometry", async () => {
  const { circuitJson, copperScope } = await renderRoutedCopper()
  const db = cju(circuitJson)
  const [pour] = db.pcb_copper_pour.list()
  assert(pour)
  const solver = new CopperGeometryExtractionSolver({
    circuitJson,
    copperScope,
    requiredSourcePortIds: [],
    artifactPrefix: "test",
  })
  solver.step()
  assert.equal(solver.solved, false)
  assert.equal(solver.stats.traces, 1)
  solver.solve()
  const { value: copperGeometry, artifacts } = solver.getOutput()
  assert.deepEqual(
    copperGeometry.geometry.wires.map(({ startPoint, endPoint, widthMm }) => [
      startPoint,
      endPoint,
      widthMm,
    ]),
    [
      [[-4, 0], [4, 0], 0.1],
      [[-4, 0.35], [4, 0.35], 0.1],
    ],
  )
  const [section] = copperGeometry.geometry.sections
  assert.equal(copperGeometry.geometry.sections.length, 1)
  assert.equal(section.startMm, -4)
  assert.equal(section.endMm, 4)
  assert.equal(section.wires.length, 2)
  assert.deepEqual(
    section.references.map(({ pcbCopperPourId }) => pcbCopperPourId),
    [pour.pcb_copper_pour_id],
  )
  assert.deepEqual(
    artifacts.map(({ path }) => path),
    ["test/copper-geometry-extraction.json", "test/scope.json"],
  )
})

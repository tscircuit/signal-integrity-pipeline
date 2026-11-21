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

import { test } from "bun:test"
import assert from "node:assert/strict"
import { TransmissionLineRlgcSolver } from "../../../src/rlgc"
import {
  CopperTrace,
  getCopperGeometryExtractionInput,
  renderCopperGeometryBoard,
} from "../../fixtures/copper-geometry-board"
import { solveBoardCopperGeometry } from "../../fixtures/transmission-line-rlgc"

test("identifies the input section of each pair across a reference handoff", async () => {
  const circuit = await renderCopperGeometryBoard({
    children: (
      <>
        <CopperTrace name="First" />
        <CopperTrace name="Other" startY={0.5} net="net.OTHER" />
      </>
    ),
    reference: (
      <>
        <copperpour connectsTo="net.GND" layer="bottom" unbroken />
        <copperpour
          connectsTo="net.GND"
          layer="inner1"
          unbroken
          outline={[
            { x: 0, y: -2 },
            { x: 6, y: -2 },
            { x: 6, y: 2 },
            { x: 0, y: 2 },
          ]}
        />
      </>
    ),
  })
  const copper = solveBoardCopperGeometry(
    getCopperGeometryExtractionInput({ circuit }),
  )
  const { sections } = copper.geometry
  assert.equal(sections.length, 2)
  assert.deepEqual(
    sections.map(({ references }) => references[0].layer),
    ["bottom", "inner1"],
  )
  const solver = new TransmissionLineRlgcSolver({
    copperGeometry: copper,
    artifactPrefix: "test",
  })
  solver.solve()
  const {
    value: output,
    artifacts: [artifact],
  } = solver.getOutput()
  assert.deepEqual(
    output.pairCouplings.map((pair) => pair.wireSectionIndex),
    [0, 1],
  )
  const published = JSON.parse(artifact.body) as typeof output
  for (const pair of published.pairCouplings) {
    const wireSection = sections[pair.wireSectionIndex]
    const solvedGroups = published.solvedWireSections.filter(
      (group) => group.wireSectionIndex === pair.wireSectionIndex,
    )
    assert(solvedGroups.length > 0)
    for (const group of solvedGroups) {
      assert.equal(group.startMm, wireSection.startMm)
      assert.equal(group.endMm, wireSection.endMm)
      assert.deepEqual(group.references, wireSection.references)
    }
  }
})

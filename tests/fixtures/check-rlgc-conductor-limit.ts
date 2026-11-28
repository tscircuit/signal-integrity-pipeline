import assert from "node:assert/strict"
import { calculateCapacitanceMatrix } from "../../src/rlgc"
import { renderCrossSectionConductor } from "./cross-section-board"

const conductor = await renderCrossSectionConductor({
  zMm: 0.25,
  widthMm: 0.4,
  thicknessMm: 0.035,
})
const conductorCount = 512
const conductors = Array.from({ length: conductorCount + 1 }, (_, index) => ({
  ...conductor,
  conductorId: `${conductor.conductorId}-${index}`,
  zMm: conductor.zMm + index,
}))
const crossSection = {
  conductors,
  planes: Array.from({ length: conductors.length + 1 }, (_, zMm) => ({
    zMm,
  })),
  dielectricLayers: [],
}
assert.throws(() => calculateCapacitanceMatrix({ crossSection }), {
  code: "mesh_panel_limit",
  message: /conductor limit of 512/,
})
const matrix = calculateCapacitanceMatrix({
  crossSection: { ...crossSection, conductors: conductors.slice(0, -1) },
  options: { panelsPerEdge: 6 },
})
assert.equal(matrix.length, conductorCount)
assert.ok(Number.isFinite(matrix[0][0]) && matrix[0][0] > 0)
for (const [rowIndex, row] of matrix.entries()) {
  assert.equal(row.length, conductorCount)
  assert.ok(
    row.every((coefficient, columnIndex) =>
      columnIndex === rowIndex
        ? coefficient === matrix[0][0]
        : coefficient === 0,
    ),
  )
}

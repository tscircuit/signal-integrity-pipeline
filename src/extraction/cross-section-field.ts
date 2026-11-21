import { sectionKernel } from "./cross-section-kernel"
import { sectionFactor, sectionReciprocity } from "./cross-section-matrix"
import { sectionPanels } from "./cross-section-mesh"
import { type SectionMeshInput, sectionEpsilon0 } from "./cross-section-types"
import { fail } from "./diagnostics"
import { type Matrix, symmetrize } from "./linalg"

/** Largest raw reciprocity residual allowed before requesting a finer mesh or wider domain. */
const MAX_RECIPROCITY_RESIDUAL = 0.015

/** Capacitance and dielectric loss matrices with mesh size and reciprocity error. */
interface SectionFieldResult {
  C: Matrix
  loss: Matrix
  panels: number
  residual: number
}

/** Solve potential and dielectric-transmission equations; differentiate the SAME field operator
 * for material loss. This is the electrostatic energy sensitivity, not an averaged loss tangent.
 */
export function sectionField(mesh: SectionMeshInput): SectionFieldResult {
  const { region, vacuum } = mesh
  const panels = sectionPanels(mesh)
  const size = region.conductors.length
  const rhs = panels.map((panel) =>
    Array.from({ length: size }, (_, j) => Number(panel.group === j)),
  )
  const fields: Float64Array[] = []
  const matrix = panels.map((a, i) => {
    const row = Float64Array.from(panels, (b) =>
      sectionKernel({ a, b, height: region.height }),
    )
    if (a.group >= 0) return row
    fields[i] = row.slice()
    for (let j = 0; j < panels.length; j++)
      row[j] = Number(i === j) - a.contrast * a.length * row[j]
    return row
  })
  const solve = sectionFactor(matrix)
  const charge = solve(rhs)
  const hasLoss =
    !vacuum && region.dielectrics.some((layer) => layer.lossTangent > 0)
  let lossCharge = panels.map((panel, i) => {
    if (!hasLoss || panel.group >= 0) return Array<number>(size).fill(0)
    return Array.from({ length: size }, (_, j) => {
      const fieldCharge = charge.reduce(
        (sum, row, k) => sum + fields[i][k] * row[j],
        0,
      )
      return panel.derivative * panel.length * fieldCharge
    })
  })
  if (hasLoss) lossCharge = solve(lossCharge)
  const C: Matrix = Array.from({ length: size }, () => Array(size).fill(0))
  const loss = C.map((row) => [...row])
  for (const [k, panel] of panels.entries()) {
    if (panel.group < 0) continue
    for (let j = 0; j < size; j++) {
      C[panel.group][j] += sectionEpsilon0 * panel.er * charge[k][j]
      loss[panel.group][j] +=
        sectionEpsilon0 *
        panel.er *
        (lossCharge[k][j] + panel.tangent * charge[k][j])
    }
  }
  const residual = Math.max(sectionReciprocity(C), sectionReciprocity(loss))
  if (!Number.isFinite(residual) || residual > MAX_RECIPROCITY_RESIDUAL) {
    fail(
      "reciprocity",
      `Cross-section raw reciprocity ${residual}; refine panels or interface extent`,
    )
  }
  return {
    C: symmetrize(C),
    loss: symmetrize(loss),
    panels: panels.length,
    residual,
  }
}

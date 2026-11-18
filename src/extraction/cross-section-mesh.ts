import { copperConductivity, type CrossSection, type SectionDielectric, type SectionMeshInput, type SectionPanel, type SectionRegion } from './cross-section-types'
import { fail } from './diagnostics'

/** Material adjacent to a boundary; non-overlapping slabs leave air elsewhere. */
function material(layers: SectionDielectric[], z: number): { er: number; lossTangent: number } {
  return layers.find(layer => z > layer.zMm && z < layer.zMm + layer.thicknessMm) ?? { er: 1, lossTangent: 0 }
}

/** Merge floating-point copies of one boundary before making panels; never create zero-size seams. */
function coordinates(values: number[], tolerance: number): number[] {
  return values.sort((a, b) => a - b).filter((value, i, sorted) => !i || value - sorted[i - 1] > tolerance)
}

/** Reflect an upper-only reference, and split signals into regions shielded by solid planes. */
export function sectionRegions(section: CrossSection): { region: SectionRegion; indices: number[] }[] {
  const planes = [...section.planes].sort((a, b) => a.zMm - b.zMm)
  const groups = new Map<number, number[]>()
  for (const [i, conductor] of section.conductors.entries()) {
    const key = planes.filter(plane => plane.zMm < conductor.zMm).length
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  return [...groups].map(([key, indices]) => {
    const below = planes[key - 1]
    const above = planes[key]
    const origin = below?.zMm ?? above.zMm
    const lower = below ?? above
    const conductors = indices.map(i => {
      const c = section.conductors[i]
      if (below) return { ...c, zMm: c.zMm - origin }
      return { ...c, zMm: origin - c.zMm - c.thicknessMm }
    })
    let height = 0
    if (below && above) height = above.zMm - below.zMm
    const dielectrics = section.dielectrics.map(layer => {
      let lo = Math.max(0, layer.zMm - origin)
      let hi = Math.min(height || Infinity, layer.zMm + layer.thicknessMm - origin)
      if (!below) {
        lo = Math.max(0, origin - layer.zMm - layer.thicknessMm)
        hi = Math.min(height || Infinity, origin - layer.zMm)
      }
      return { ...layer, zMm: lo, thicknessMm: hi - lo }
    }).filter(layer => layer.thicknessMm > 1e-12)
    return { indices, region: { conductors, dielectrics, height, lowerConductivity: lower.conductivitySm ?? copperConductivity, upperConductivity: above?.conductivitySm ?? copperConductivity } }
  })
}

interface SectionEdge {
  x1: number
  z1: number
  x2: number
  z2: number
  group: number
  er: number
  lossTangent: number
  contrast?: number
  derivative?: number
  reach?: number
}

/** Quartic grading resolves the integrable corner charge singularity. */
function panelFraction(i: number, steps: number): number {
  return i ** 4 / (i ** 4 + (steps - i) ** 4)
}

/** Append panels along a straight segment, with its outward metal normal. */
function addSectionEdge(
  { x1, z1, x2, z2, group, er, lossTangent, contrast = 0, derivative = 0, reach = Infinity }: SectionEdge,
  { count, result }: { count: number; result: SectionPanel[] },
): void {
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.hypot(dx, dz)
  let steps = Math.max(count, Math.ceil(count * length / (6 * reach)))
  if (dz) steps = Math.max(4, Math.ceil(count / 3))
  for (let i = 0; i < steps; i++) {
    const lo = panelFraction(i, steps)
    const hi = panelFraction(i + 1, steps)
    result.push({ x: x1 + dx * (lo + hi) / 2, z: z1 + dz * (lo + hi) / 2, tx: dx / length, tz: dz / length, length: length * (hi - lo), group, er, tangent: lossTangent, contrast, derivative })
  }
}

/** Quartically graded surface panels, split at all material and conductor projection boundaries.
 * Only dielectric interfaces are truncated horizontally; fields and solid planes remain infinite.
 * A conductor face longer than six plane distances gets proportionally more panels, so the middle panel
 * (about 4/count of the face) stays within about two plane distances of the charge it averages.
 */
export function sectionPanels({ region, count, extent, vacuum }: SectionMeshInput): SectionPanel[] {
  const result: SectionPanel[] = []
  const scale = Math.max(...region.conductors.map(c => Math.max(c.widthMm, c.zMm + c.thicknessMm)), ...region.dielectrics.map(d => d.zMm + d.thicknessMm))
  const probe = Math.min(...region.conductors.flatMap(c => [c.widthMm, c.thicknessMm]), ...region.dielectrics.map(d => d.thicknessMm)) * 1e-7
  let layers = region.dielectrics
  if (vacuum) layers = []
  const mesh = { count, result }
  for (const [group, c] of region.conductors.entries()) {
    const left = c.xMm - c.widthMm / 2
    const right = c.xMm + c.widthMm / 2
    const top = c.zMm + c.thicknessMm
    const bottomMaterial = material(layers, c.zMm - probe)
    const topMaterial = material(layers, top + probe)
    let reach = c.zMm
    if (region.height) reach = Math.min(reach, region.height - top)
    addSectionEdge({ x1: left, z1: c.zMm, x2: right, z2: c.zMm, group, ...bottomMaterial, reach }, mesh)
    addSectionEdge({ x1: right, z1: top, x2: left, z2: top, group, ...topMaterial, reach }, mesh)
    const cuts = coordinates([c.zMm, top, ...layers.flatMap(d => [d.zMm, d.zMm + d.thicknessMm]).filter(z => z > c.zMm + probe / 100 && z < top - probe / 100)], probe / 100)
    for (let k = 1; k < cuts.length; k++) {
      const adjacent = material(layers, (cuts[k - 1] + cuts[k]) / 2)
      addSectionEdge({ x1: right, z1: cuts[k - 1], x2: right, z2: cuts[k], group, ...adjacent }, mesh)
      addSectionEdge({ x1: left, z1: cuts[k], x2: left, z2: cuts[k - 1], group, ...adjacent }, mesh)
    }
  }
  const projections = region.conductors.flatMap(c => [c.xMm - c.widthMm / 2, c.xMm + c.widthMm / 2])
  const xs = coordinates([Math.min(...projections) - extent * scale, ...projections, Math.max(...projections) + extent * scale], probe / 100)
  const boundaries = coordinates(layers.flatMap(d => [d.zMm, d.zMm + d.thicknessMm]), probe / 100).filter(z => z > probe / 100 && (!region.height || z < region.height - probe / 100))
  for (const z of boundaries) {
    const below = material(layers, z - probe)
    const above = material(layers, z + probe)
    if (below.er === above.er && below.lossTangent === above.lossTangent) continue
    const contrast = 2 * (below.er - above.er) / (below.er + above.er)
    const derivative = 4 * below.er * above.er * (below.lossTangent - above.lossTangent) / (below.er + above.er) ** 2
    for (let k = 1; k < xs.length; k++) {
      const middle = (xs[k - 1] + xs[k]) / 2
      if (region.conductors.some(c => middle > c.xMm - c.widthMm / 2 && middle < c.xMm + c.widthMm / 2 && z >= c.zMm - probe && z <= c.zMm + c.thicknessMm + probe)) continue
      addSectionEdge({ x1: xs[k - 1], z1: z, x2: xs[k], z2: z, group: -1, er: 1, lossTangent: 0, contrast, derivative }, mesh)
    }
  }
  return result
}

/** Reject unsupported/degenerate geometry rather than changing copper or material boundaries. */
export function validateSection(section: CrossSection): void {
  if (!section.conductors.length || !section.planes.length) fail('native_geometry', 'A cross-section needs signals and at least one solid reference plane')
  const ids = new Set(section.conductors.map(c => c.id))
  if (ids.size !== section.conductors.length || [...ids].some(id => !id)) fail('native_geometry', 'Cross-section conductor IDs must be unique and nonempty')
  for (const c of section.conductors) {
    if (![c.xMm, c.zMm, c.widthMm, c.thicknessMm, c.conductivitySm ?? copperConductivity].every(Number.isFinite) || c.widthMm <= 0 || c.thicknessMm <= 0 || (c.conductivitySm ?? copperConductivity) <= 0) fail('native_geometry', 'Finite positive conductor dimensions and conductivity required')
    if (section.planes.some(p => p.zMm >= c.zMm && p.zMm <= c.zMm + c.thicknessMm)) fail('native_geometry', 'A signal touches or crosses a reference plane')
  }
  for (const [i, a] of section.conductors.entries()) for (const b of section.conductors.slice(i + 1)) {
    if (Math.abs(a.xMm - b.xMm) <= (a.widthMm + b.widthMm) / 2 && a.zMm <= b.zMm + b.thicknessMm && b.zMm <= a.zMm + a.thicknessMm) fail('native_geometry', 'Signal rectangles overlap or touch')
  }
  for (const [i, p] of section.planes.entries()) if (![p.zMm, p.conductivitySm ?? copperConductivity].every(Number.isFinite) || (p.conductivitySm ?? copperConductivity) <= 0 || section.planes.slice(i + 1).some(q => q.zMm === p.zMm)) fail('native_geometry', 'Reference planes need unique finite heights and positive conductivity')
  for (const [i, a] of section.dielectrics.entries()) {
    if (![a.zMm, a.thicknessMm, a.er, a.lossTangent].every(Number.isFinite) || a.thicknessMm <= 0 || a.er < 1 || a.lossTangent < 0) fail('native_geometry', 'Finite positive slabs, er >= 1 and nonnegative loss tangent required')
    if (section.dielectrics.slice(i + 1).some(b => a.zMm < b.zMm + b.thicknessMm - 1e-12 && b.zMm < a.zMm + a.thicknessMm - 1e-12)) fail('native_geometry', 'Dielectric slabs overlap')
  }
}

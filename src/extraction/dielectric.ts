import { polygonContains, type GeometryCell, type ExtractionSettings, type CopperXYZ as XYZ } from '../board'
import { pathSolids, surfacePanels, copperPanelSizing, type PanelSizing } from './mesh'

type DielectricInterfaceKey = string

/** Read a panel's vertices and outward unit normal. Copper and slab surfaces are outward wound. */
function panel(row: string): { center: XYZ; normal: XYZ } {
  const coordinates = row.split(' ').slice(2).map(Number)
  const points = Array.from({ length: coordinates.length / 3 }, (_, i) => coordinates.slice(i * 3, i * 3 + 3) as XYZ)
  const [a, b, c] = points
  const u = b.map((v, i) => v - a[i])
  const v = c.map((v, i) => v - a[i])
  const cross: XYZ = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const length = Math.hypot(...cross)
  return { center: [0, 1, 2].map(i => points.reduce((sum, p) => sum + p[i], 0) / points.length) as XYZ, normal: cross.map(v => v / length) as XYZ }
}

/** Material at a point just outside an oriented panel, including finite board edges. */
function medium(point: XYZ, dielectric: NonNullable<GeometryCell['dielectric']>): number {
  if (!polygonContains([point[0], point[1]], dielectric.polygon)) return 1
  return dielectric.layers.find(layer => point[2] > layer.zMinMm && point[2] < layer.zMaxMm)?.relativePermittivity ?? 1
}

/** Offset by a sub-nanometre amount, far below the smallest declared copper thickness. */
function panelProbePoint(center: XYZ, normal: XYZ): XYZ {
  return center.map((coordinate, i) => coordinate + normal[i] * 1e-7) as XYZ
}

/** Physical finite-board dielectric interfaces; conductor faces are assigned their adjacent medium. */
export function layeredCapacitanceDeck(cell: GeometryCell, extraction?: Pick<ExtractionSettings, 'maxPanelLengthMm'>): Record<string, string> {
  const copper = (cell.routedCopper ?? cell.capacitanceCopper)!
  const dielectric = cell.dielectric!
  const files: Record<string, string> = {}
  const list = ['* Actual copper and finite layered dielectric in millimetres; raw capacitance * 0.001 = F']
  const solids = [...copper.signals.map(pathSolids), [...copper.pours, ...copper.connections.flatMap(pathSolids)]]
  const all = solids.flat()
  const layers = dielectric.layers
  if (layers.some(layer => !layer.relativePermittivity || layer.relativePermittivity < 1)) throw new Error('Every dielectric layer needs a physical relative permittivity')
  const cuts = layers.flatMap(layer => [layer.zMinMm, layer.zMaxMm])
  let sizing: PanelSizing | undefined
  let interfaceSizing: PanelSizing | undefined
  if (extraction) {
    sizing = copperPanelSizing(copper, extraction.maxPanelLengthMm)
    interfaceSizing = copperPanelSizing({ ...copper, signals: [...copper.signals, ...copper.connections] }, extraction.maxPanelLengthMm)
  }
  solids.forEach((pieces, i) => {
    let name = 'return'
    if (i < copper.signals.length) name = `sig${i}`
    const groups = new Map<number, string[]>()
    for (const row of surfacePanels({ solids: pieces, name, sizing, cuts }).split('\n').filter(row => /^[TQ] /.test(row))) {
      const { center, normal } = panel(row)
      const er = medium(panelProbePoint(center, normal), dielectric)
      if (!groups.has(er)) groups.set(er, [])
      groups.get(er)!.push(row)
    }
    // '+' connects successive surface files into the same physical conductor.
    const entries = [...groups].sort(([a], [b]) => a - b)
    entries.forEach(([er, rows], j) => {
      let file = `${name}.txt`
      if (j) file = `${name}-${j}.txt`
      files[file] = '* Conductor faces in one adjacent medium; millimetres\n' + rows.join('\n') + '\n'
      let join = ''
      if (j < entries.length - 1) join = ' +'
      list.push(`C ${file} ${er} 0 0 0${join}`)
    })
  })
  layers.forEach((layer, i) => {
    const groups = new Map<DielectricInterfaceKey, { rows: string[]; er: number; reference: XYZ }>()
    const slab = { ...layer, polygon: dielectric.polygon }
    for (const row of surfacePanels({ solids: [slab], name: `diel${i}`, sizing: interfaceSizing, exclude: all, cuts }).split('\n').filter(row => /^[TQ] /.test(row))) {
      const { center, normal } = panel(row)
      const outside = panelProbePoint(center, normal)
      // Copper/dielectric contacts are C faces, never duplicate D faces.
      if (all.some(s => outside[2] > s.zMinMm && outside[2] < s.zMaxMm && polygonContains([outside[0], outside[1]], s.polygon))) continue
      const er = medium(outside, dielectric)
      if (er === layer.relativePermittivity) continue
      // An interface shared by two layers is emitted once, by the lower layer.
      if (er !== 1 && normal[2] < 0) continue
      const key = [er, ...normal, normal.reduce((sum, v, j) => sum + v * center[j], 0)].map(v => v.toFixed(8)).join(',')
      if (!groups.has(key)) groups.set(key, { rows: [], er, reference: center.map((v, j) => v - normal[j] * .01) as XYZ })
      groups.get(key)!.rows.push(row)
    }
    ;[...groups.values()].forEach(({ rows, er, reference }, j) => {
      const file = `dielectric-${i}-${j}.txt`
      files[file] = '* Dielectric interface only; millimetres\n' + rows.join('\n') + '\n'
      list.push(`D ${file} ${er} ${layer.relativePermittivity} 0 0 0 ${reference.join(' ')} -`)
    })
  })
  files['channel.lst'] = list.join('\n') + '\n'
  return files
}

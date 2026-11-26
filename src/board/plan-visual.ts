import type { GraphicsObject, Viewbox } from "graphics-debug"
import { drawCopper } from "./plan-copper"
import { buildPlanHeader } from "./plan-header"
import { placePlanLabels } from "./plan-labels"
import {
  buildEndpointShape,
  buildOverlayLine,
  buildOverlayShapes,
  buildRing,
  buildViaShapes,
  getEndpointRadiusMm,
} from "./plan-marks"
import { buildBoardShapes, drawPlanPolygon } from "./plan-shapes"
import {
  buildPlanFrame,
  clipPlanLines,
  clipPlanPolygons,
  getBoardBounds,
  getBoxPoints,
  getCopperSearchBox,
  getPointBounds,
} from "./plan-view"
import {
  type PlanLine,
  type PlanPolygon,
  type PlanVisualScene,
  planColors,
} from "./plan-visual-types"

/** Scope envelope, separated from the board outline when fully in scope. */
function buildSearchEnvelope({
  searchBox,
  board,
  unitMm,
}: {
  searchBox: Viewbox
  board: Viewbox
  unitMm: number
}): PlanLine {
  const insetMm = unitMm * 0.6
  const points = getBoxPoints({
    minX: Math.max(board.minX + insetMm, searchBox.minX),
    maxX: Math.min(board.maxX - insetMm, searchBox.maxX),
    minY: Math.max(board.minY + insetMm, searchBox.minY),
    maxY: Math.min(board.maxY - insetMm, searchBox.maxY),
  })
  return {
    points: [...points, points[0]],
    strokeColor: planColors.scope,
    strokeWidth: unitMm * 0.37,
    strokeDash: "4,4",
    mark: "envelope",
    layer: "scope",
    label: "Copper search envelope",
  }
}

/** Explain only the symbols that were drawn inside the board window. */
function buildPlanLegend({
  scene,
  polygons,
  lines,
}: {
  scene: PlanVisualScene
  polygons: readonly PlanPolygon[]
  lines: readonly PlanLine[]
}): string[] {
  const kinds = new Set(polygons.map(({ endpointKind }) => endpointKind))
  const lineMarks = new Set(lines.map(({ mark }) => mark))
  const labels: string[] = []
  if (kinds.has("driver")) labels.push("▶ driver")
  if (kinds.has("receiver")) labels.push("◉ receiver")
  if (kinds.has("ideal") && kinds.has("extraTraceEnd"))
    labels.push("◇ ideal receiver or extra trace end")
  else if (kinds.has("ideal")) labels.push("◇ ideal receiver")
  else if (kinds.has("extraTraceEnd")) labels.push("◇ extra trace end")
  if (polygons.some(({ layer }) => layer === "paths"))
    labels.push("› direction")
  if (polygons.some(({ layer }) => layer === "copper")) labels.push("◎ via")
  if (polygons.some(({ layer }) => layer === "topology"))
    labels.push("~ series part")
  if (lineMarks.has("ideal")) labels.push("-- ideal connection")
  if (lineMarks.has("envelope")) labels.push("▪▪ copper search envelope")
  if (lineMarks.has("missing")) labels.push("-×- incomplete route")
  const hasBypass = lineMarks.has("bypass")
  if (hasBypass) labels.push("-×- bypass")
  if (lineMarks.has("traceFault")) {
    if (hasBypass) labels.push("× bypassed trace")
    else if (scene.traceFaultKind === "loop") labels.push("× trace in loop")
    else if (scene.traceFaultKind === "branch") labels.push("× branched trace")
    else labels.push("× shorted trace")
  }
  return labels
}

/** The lines and symbols for ideal, series and fault connections. */
interface PlanOverlays {
  lines: PlanLine[]
  polygons: PlanPolygon[]
}

/** Resolve overlay endpoints and keep bypasses above the corresponding ideal connection. */
function renderOverlays({
  scene,
  unitMm,
}: {
  scene: PlanVisualScene
  unitMm: number
}): PlanOverlays {
  const { ports } = scene
  const lines: PlanLine[] = []
  const polygons: PlanPolygon[] = []
  for (const overlay of scene.overlays) {
    if (
      overlay.kind === "ideal" &&
      scene.overlays.some(
        ({ kind, fromSourcePortId, toSourcePortId }) =>
          kind === "short" &&
          fromSourcePortId === overlay.fromSourcePortId &&
          toSourcePortId === overlay.toSourcePortId,
      )
    )
      continue
    const from = ports.get(overlay.fromSourcePortId)
    const to = ports.get(overlay.toSourcePortId)
    if (!from || !to) continue
    const line: PlanLine = buildOverlayLine({ overlay, from, to, unitMm })
    if (overlay.kind === "ideal" || overlay.kind === "missing")
      line.mark = overlay.kind
    if (overlay.kind === "short") line.mark = "bypass"
    lines.push(line)
    polygons.push(...buildOverlayShapes({ overlay, from, to, unitMm }))
  }
  return { lines, polygons }
}

/** Draw declared endpoints and replace faulted endpoint glyphs with fault markers. */
function renderContactMarks({
  scene,
  radiusMm,
  traceFaults,
}: {
  scene: PlanVisualScene
  radiusMm: number
  traceFaults: readonly PlanPolygon[]
}): PlanPolygon[] {
  const { ports, faultSourcePortIds } = scene
  const polygons: PlanPolygon[] = []
  for (const endpoint of scene.endpoints) {
    const point = ports.get(endpoint.sourcePortId)
    if (point && !faultSourcePortIds.has(endpoint.sourcePortId))
      polygons.push(
        ...buildEndpointShape({ point, endpoint, radiusMm, ports }).map(
          (shape) => ({
            ...shape,
            endpointKind: endpoint.kind,
          }),
        ),
      )
  }
  polygons.push(...traceFaults)
  for (const sourcePortId of faultSourcePortIds) {
    const port = ports.get(sourcePortId)
    if (!port) continue
    const label = `Fault port · ${port.label} (${sourcePortId})`
    polygons.push(
      {
        points: buildRing({ center: port, radiusMm: radiusMm * 1.08 }),
        fill: "#fff",
        stroke: planColors.failure,
        strokeWidth: radiusMm * 0.34,
        label,
        layer: "failure",
      },
      {
        points: buildRing({ center: port, radiusMm: radiusMm * 0.36 }),
        fill: planColors.failure,
        stroke: "none",
        label,
        layer: "failure",
      },
    )
  }
  return polygons
}

/** Draw one attempted simulation with a separate centered text band. */
export function renderPlanDrawing(scene: PlanVisualScene): GraphicsObject {
  const { db, copperScope, faultSourcePortIds, ports } = scene
  const board = getBoardBounds(db)
  const active = new Set([
    ...scene.endpoints.map((end) => end.sourcePortId),
    ...faultSourcePortIds,
  ])
  for (const { fromSourcePortId, toSourcePortId } of [
    ...scene.traces,
    ...scene.overlays,
  ]) {
    active.add(fromSourcePortId)
    active.add(toSourcePortId)
  }
  const searchBox = copperScope && getCopperSearchBox({ board, copperScope })
  const frame = buildPlanFrame({ board, focus: searchBox })
  const { unitMm, crop } = frame
  const copper = drawCopper({ scene, ports, unitMm })
  const lines = [...copper.lines]
  if (searchBox) lines.push(buildSearchEnvelope({ searchBox, board, unitMm }))
  const polygons: PlanPolygon[] = [
    ...buildBoardShapes({ db, board, active, ports, unitMm }),
    ...buildViaShapes({ db, copperScope, unitMm }),
    ...copper.chevrons,
  ]
  const overlays = renderOverlays({ scene, unitMm })
  lines.push(...overlays.lines)
  polygons.push(...overlays.polygons)
  const radiusMm = getEndpointRadiusMm({
    unitMm,
    ports: [...ports.values()].filter(({ sourcePortId }) =>
      active.has(sourcePortId),
    ),
  })
  polygons.push(
    ...renderContactMarks({ scene, radiusMm, traceFaults: copper.faults }),
  )
  const boardPolygons = clipPlanPolygons({ polygons, crop })
  const boardLines = clipPlanLines({ lines, crop })
  const labels = placePlanLabels({
    scene,
    frame,
    ports,
    radiusMm,
    polygons: boardPolygons,
    lines: boardLines,
  })
  const extent = getPointBounds([
    ...labels.backgrounds.flatMap(({ points }) => points),
    ...labels.texts,
    ...boardPolygons.flatMap(({ points }) => points),
    ...boardLines.flatMap(({ points }) => points),
    ...getBoxPoints(frame.box),
  ])
  const rows = [...scene.rows]
  if (scene.summary) {
    const { text, scopedText } = scene.summary
    let summary = text
    if (
      scopedText &&
      searchBox &&
      (searchBox.minX > board.minX ||
        searchBox.maxX < board.maxX ||
        searchBox.minY > board.minY ||
        searchBox.maxY < board.maxY)
    )
      summary = scopedText
    rows.unshift({ text: summary, color: planColors.quiet })
  }
  let boardTopMm = frame.box.maxY
  if (extent) boardTopMm = extent.maxY
  const header = buildPlanHeader({
    scene: { ...scene, rows },
    frame,
    boardTopMm,
    legend: [
      ...buildPlanLegend({ scene, polygons: boardPolygons, lines: boardLines }),
      ...labels.pourLegendEntries,
    ],
  })
  return {
    title: scene.title,
    coordinateSystem: "cartesian",
    lines: [...boardLines, ...labels.leaders, ...header.lines],
    polygons: [
      ...boardPolygons.flatMap(drawPlanPolygon),
      ...labels.backgrounds,
    ],
    texts: [...labels.texts, ...header.texts],
    rects: header.rects,
  }
}

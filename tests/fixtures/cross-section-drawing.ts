import type { GraphicsObject, Line } from "graphics-debug"
import type { CrossSection } from "../../src/rlgc"
import { buildRegionPanels } from "../../src/rlgc/cross-section-mesh"
import { partitionCrossSection } from "../../src/rlgc/cross-section-regions"

const PLANE_COLOR = "#263758"
const CONDUCTOR_COLOR = "#b35a25"
const INTERFACE_COLOR = "#006c74"
const PANEL_COLORS = ["#2b303b", "#728299"] as const

/** Draw the center of a cross-section to scale with the computed panel endpoints. */
export function drawCrossSection({
  crossSection,
  halfWidthMm,
  title,
}: {
  crossSection: CrossSection
  halfWidthMm: number
  title: string
}): GraphicsObject {
  const [{ region }] = partitionCrossSection(crossSection)
  const panels = buildRegionPanels({
    region,
    panelsPerEdge: 12,
    interfaceExtent: 24,
  })
  const topMm = Math.max(
    region.planeSpacingMm,
    ...region.dielectricLayers.map((layer) => layer.zMm + layer.thicknessMm),
  )
  const lines: Line[] = panels.flatMap((panel, index) => {
    const dx = (panel.tangentX * panel.lengthMm) / 2
    const dz = (panel.tangentZ * panel.lengthMm) / 2
    const startXMm = panel.centerXMm - dx
    const endXMm = panel.centerXMm + dx
    if (Math.max(Math.abs(startXMm), Math.abs(endXMm)) > halfWidthMm) return []
    let strokeColor: string = PANEL_COLORS[index % 2]
    if (panel.conductorIndex < 0) strokeColor = INTERFACE_COLOR
    return [
      {
        points: [
          { x: startXMm, y: panel.centerZMm - dz },
          { x: endXMm, y: panel.centerZMm + dz },
        ],
        strokeColor,
        strokeWidth: 0.012,
      },
    ]
  })
  const planeHeightsMm = [0]
  if (region.planeSpacingMm > 0) planeHeightsMm.push(region.planeSpacingMm)
  for (const planeZMm of planeHeightsMm) {
    lines.push({
      points: [
        { x: -halfWidthMm, y: planeZMm },
        { x: halfWidthMm, y: planeZMm },
      ],
      strokeColor: PLANE_COLOR,
      strokeWidth: 0.025,
    })
  }
  const scaleY = -0.18
  lines.push({
    points: [
      { x: -0.5, y: scaleY },
      { x: 0.5, y: scaleY },
    ],
    strokeColor: PLANE_COLOR,
    strokeWidth: 0.012,
  })
  return {
    rects: region.conductors.map((conductor) => ({
      center: {
        x: conductor.xMm,
        y: conductor.zMm + conductor.thicknessMm / 2,
      },
      width: conductor.widthMm,
      height: conductor.thicknessMm,
      fill: CONDUCTOR_COLOR,
    })),
    lines,
    points: panels.flatMap((panel) => {
      const x = panel.centerXMm - (panel.tangentX * panel.lengthMm) / 2
      const y = panel.centerZMm - (panel.tangentZ * panel.lengthMm) / 2
      if (Math.abs(x) > halfWidthMm || panel.conductorIndex >= 0) return []
      return [{ x, y, color: INTERFACE_COLOR }]
    }),
    texts: [
      { x: 0, y: topMm + 0.32, text: title, fontSize: 0.13 },
      { x: 0, y: scaleY - 0.1, text: "1 mm", fontSize: 0.085 },
      ...region.dielectricLayers.map((layer) => {
        let labelZMm = layer.zMm + layer.thicknessMm / 2
        if (layer.thicknessMm < 0.1)
          labelZMm = layer.zMm + layer.thicknessMm + 0.09
        return {
          x: -halfWidthMm + 0.12,
          y: labelZMm,
          text: `εr ${layer.relativePermittivity} · tan δ ${layer.lossTangent}`,
          anchorSide: "center_left" as const,
          fontSize: 0.085,
        }
      }),
    ],
  }
}

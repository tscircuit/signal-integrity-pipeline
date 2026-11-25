import type { LayerRef } from "circuit-json"
import type { BoardStackup, ExtractedCopper, WireSection } from "../board"
import type { Snapshot } from "../kernel"
import type { CrossSection, CrossSectionDielectricLayer } from "./cross-section"
import { DIELECTRIC_BOUNDARY_TOLERANCE_MM } from "./cross-section-regions"
import { fail } from "./diagnostics"
import {
  buildDielectricLayers,
  type DielectricMaterials,
} from "./dielectric-materials"

type CopperLayer = Snapshot<BoardStackup["copperLayers"][number]>

/** Resolve the material and dimensions of a named board copper layer. */
function getCopperLayer({
  copperLayers,
  layer,
}: {
  copperLayers: readonly CopperLayer[]
  layer: LayerRef
}): CopperLayer {
  const copperLayer = copperLayers.find(({ name }) => name === layer)
  if (!copperLayer)
    fail({
      code: "cross_section_geometry",
      text: `Missing stackup copper layer ${layer}`,
    })
  return copperLayer
}

/** Keep the board dielectric layers on the wire-facing side of each reference surface. */
function clipDielectricLayers({
  dielectricLayers,
  wireSection,
  copperLayers,
}: {
  dielectricLayers: CrossSectionDielectricLayer[]
  wireSection: Snapshot<WireSection>
  copperLayers: readonly CopperLayer[]
}): CrossSectionDielectricLayer[] {
  let lowerBoundMm = -Infinity
  let upperBoundMm = Infinity
  for (const reference of wireSection.references) {
    const copperLayer = getCopperLayer({ copperLayers, layer: reference.layer })
    if (reference.surfaceZMm === copperLayer.zMinMm) {
      upperBoundMm = Math.min(upperBoundMm, reference.surfaceZMm)
      continue
    }
    lowerBoundMm = Math.max(lowerBoundMm, reference.surfaceZMm)
  }
  return dielectricLayers.flatMap((layer) => {
    const zMm = Math.max(lowerBoundMm, layer.zMm)
    const thicknessMm =
      Math.min(upperBoundMm, layer.zMm + layer.thicknessMm) - zMm
    if (thicknessMm <= DIELECTRIC_BOUNDARY_TOLERANCE_MM) return []
    if (zMm === layer.zMm && layer.zMm + layer.thicknessMm <= upperBoundMm)
      return [layer]
    return [{ ...layer, zMm, thicknessMm }]
  })
}

/** Project a wire section to the relative geometry and materials used by calculateRlgc. */
export function buildCrossSection({
  geometry: { stackup },
  wireSection,
  materials,
}: {
  geometry: Snapshot<Pick<ExtractedCopper, "stackup">>
  wireSection: Snapshot<WireSection>
  materials: DielectricMaterials
}): CrossSection {
  const [firstWire] = wireSection.wires
  if (!firstWire)
    fail({
      code: "cross_section_geometry",
      text: "A wire section needs at least one wire",
    })
  const { copperLayers } = stackup
  const dielectricLayers = clipDielectricLayers({
    dielectricLayers: buildDielectricLayers({ stackup, materials }),
    wireSection,
    copperLayers,
  })
  const conductors = wireSection.wires.map((wire, conductorIndex) => {
    const copperLayer = getCopperLayer({ copperLayers, layer: wire.layer })
    return {
      conductorId: String(conductorIndex),
      xMm: wire.lateralOffsetMm - firstWire.lateralOffsetMm,
      zMm: copperLayer.zMinMm,
      widthMm: wire.widthMm,
      thicknessMm: copperLayer.zMaxMm - copperLayer.zMinMm,
      conductivitySm: copperLayer.conductivitySm,
    }
  })
  const planes = wireSection.references.map((reference) => ({
    zMm: reference.surfaceZMm,
    conductivitySm: getCopperLayer({ copperLayers, layer: reference.layer })
      .conductivitySm,
  }))
  planes.sort((firstPlane, secondPlane) => firstPlane.zMm - secondPlane.zMm)
  return { conductors, planes, dielectricLayers }
}

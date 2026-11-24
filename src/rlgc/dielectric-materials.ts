import type { BoardStackup } from "../board"
import { type Snapshot, snapshot } from "../kernel"
import type { CrossSectionDielectricLayer } from "./cross-section"
import { fail } from "./diagnostics"

/** Laminate loss and planar soldermask properties. */
export interface DielectricMaterials {
  readonly maskThicknessMm: number
  readonly maskRelativePermittivity: number
  readonly maskLossTangent: number
  readonly laminateLossTangent: number
}

/** Origin of the effective soldermask thickness. */
export type MaskThicknessSource = "explicit" | "stackup" | "assumed"

const assumedMaterials: DielectricMaterials = Object.freeze({
  maskThicknessMm: 0.02,
  maskRelativePermittivity: 3.3,
  maskLossTangent: 0.025,
  laminateLossTangent: 0.02,
})

/** Effective material properties and the origin of their mask thickness. */
interface ResolvedMaterials {
  materials: DielectricMaterials
  maskThicknessSource: MaskThicknessSource
}

/** Resolve the stackup and caller material declarations once before stepping. */
export function resolveMaterials({
  explicitMaterials,
  stackupMaskThicknessMm,
}: {
  explicitMaterials?: DielectricMaterials
  stackupMaskThicknessMm: number | null
}): ResolvedMaterials {
  let materials = assumedMaterials
  let maskThicknessSource: MaskThicknessSource = "assumed"
  if (stackupMaskThicknessMm !== null) {
    materials = { ...assumedMaterials, maskThicknessMm: stackupMaskThicknessMm }
    maskThicknessSource = "stackup"
  }
  if (explicitMaterials !== undefined) {
    materials = explicitMaterials
    maskThicknessSource = "explicit"
  }
  const {
    maskThicknessMm,
    maskRelativePermittivity,
    maskLossTangent,
    laminateLossTangent,
  } = materials
  if (
    !Number.isFinite(maskThicknessMm) ||
    maskThicknessMm < 0 ||
    !Number.isFinite(maskRelativePermittivity) ||
    maskRelativePermittivity < 1 ||
    !Number.isFinite(maskLossTangent) ||
    maskLossTangent < 0 ||
    !Number.isFinite(laminateLossTangent) ||
    laminateLossTangent < 0
  ) {
    fail({
      code: "cross_section_geometry",
      text: "Soldermask needs nonnegative thickness, relative permittivity >= 1, and nonnegative loss tangents for mask and laminate",
    })
  }
  return { materials: snapshot(materials), maskThicknessSource }
}

type LaminateLayer = Snapshot<BoardStackup["dielectrics"][number]>

/** Use the adjacent laminate whose center is closer to the interior copper slot. */
function findNearestLaminate({
  lowerLaminate,
  upperLaminate,
  centerMm,
}: {
  lowerLaminate: LaminateLayer
  upperLaminate: LaminateLayer
  centerMm: number
}): LaminateLayer {
  const lowerCenterMm = (lowerLaminate.zMinMm + lowerLaminate.zMaxMm) / 2
  const upperCenterMm = (upperLaminate.zMinMm + upperLaminate.zMaxMm) / 2
  if (centerMm - lowerCenterMm <= upperCenterMm - centerMm) return lowerLaminate
  return upperLaminate
}

/** Convert one stackup interval to the planar laminate model. */
function buildLaminateLayer({
  laminate,
  zMinMm,
  zMaxMm,
  lossTangent,
}: {
  laminate: LaminateLayer
  zMinMm: number
  zMaxMm: number
  lossTangent: number
}): CrossSectionDielectricLayer {
  const { relativePermittivity } = laminate
  if (relativePermittivity === undefined)
    fail({
      code: "cross_section_geometry",
      text: `Laminate at z=${laminate.zMinMm} mm needs declared relative permittivity`,
    })
  return {
    zMm: zMinMm,
    thicknessMm: zMaxMm - zMinMm,
    relativePermittivity,
    lossTangent,
  }
}

/** Fill interior copper slots with adjacent laminate and model both outer faces with soldermask. */
export function buildDielectricLayers({
  stackup,
  materials,
}: {
  stackup: Snapshot<BoardStackup>
  materials: DielectricMaterials
}): CrossSectionDielectricLayer[] {
  const { dielectrics, copperLayers } = stackup
  const dielectricLayers: CrossSectionDielectricLayer[] = []
  for (const [layerIndex, laminate] of dielectrics.entries()) {
    const lowerLaminate = dielectrics[layerIndex - 1]
    const lossTangent = materials.laminateLossTangent
    if (lowerLaminate && lowerLaminate.zMaxMm < laminate.zMinMm) {
      const zMinMm = lowerLaminate.zMaxMm
      const zMaxMm = laminate.zMinMm
      dielectricLayers.push(
        buildLaminateLayer({
          laminate: findNearestLaminate({
            lowerLaminate,
            upperLaminate: laminate,
            centerMm: (zMinMm + zMaxMm) / 2,
          }),
          zMinMm,
          zMaxMm,
          lossTangent,
        }),
      )
    }
    dielectricLayers.push(
      buildLaminateLayer({
        laminate,
        zMinMm: laminate.zMinMm,
        zMaxMm: laminate.zMaxMm,
        lossTangent,
      }),
    )
  }

  const { maskThicknessMm, maskRelativePermittivity, maskLossTangent } =
    materials
  if (maskThicknessMm === 0) return dielectricLayers
  for (const copperLayer of copperLayers) {
    if (copperLayer.name !== "top" && copperLayer.name !== "bottom") continue
    let zMm = copperLayer.zMinMm
    if (copperLayer.name === "bottom") zMm -= maskThicknessMm
    dielectricLayers.push({
      zMm,
      thicknessMm: copperLayer.zMaxMm - copperLayer.zMinMm + maskThicknessMm,
      relativePermittivity: maskRelativePermittivity,
      lossTangent: maskLossTangent,
    })
  }
  return dielectricLayers.sort(
    (firstLayer, secondLayer) => firstLayer.zMm - secondLayer.zMm,
  )
}

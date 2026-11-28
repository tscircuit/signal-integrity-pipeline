import { cju } from "@tscircuit/circuit-json-util"
import { type LayerRef, type PcbBoard, pcb_stackup } from "circuit-json"
import { fail } from "./diagnostics"
import type { CircuitJson } from "./schema"

/** Conductivity used for copper layers without a declared value, in siemens per metre. */
export const defaultCopperConductivitySm = 5.8e7

/** Rounding layer positions to 1e-10 mm prevents drift when summing thicknesses. */
const LAYER_POSITION_SCALE = 1e10

/** Rounds a layer position in millimetres to the stackup precision. */
const roundLayerPosition = (value: number): number =>
  Math.round(value * LAYER_POSITION_SCALE) / LAYER_POSITION_SCALE
export interface CopperLayer {
  name: LayerRef
  zMinMm: number
  zMaxMm: number
  conductivitySm: number
}
export interface DielectricLayer {
  material?: string
  zMinMm: number
  zMaxMm: number
  relativePermittivity?: number
}
/** Physical copper and dielectric layers in solver coordinates. */
export interface BoardStackup {
  pcbBoardId: PcbBoard["pcb_board_id"]
  copperLayers: CopperLayer[]
  dielectrics: DielectricLayer[]
  relativePermittivity?: number
  viaPlatingMm?: number
}

/** Public. Circuit JSON is top→bottom; solver z=0 is the upper face of bottom copper. */
export function stackupFromCircuitJson(circuit: CircuitJson): BoardStackup {
  const db = cju([...circuit])
  const boards = db.pcb_board.list()
  const records = db.pcb_stackup.list()
  // Plain Error (no code), exactly as before the module split.
  if (!records.length) {
    const boardId = boards[0]?.pcb_board_id ?? "(missing pcb_board)"
    const instruction =
      'Set fabricatorPreset (e.g. "jlcpcb_standard") on <board>'
    throw new Error(
      `Board ${boardId} has no pcb_stackup. ${instruction} so the JLC stackup template is resolved into Circuit JSON.`,
    )
  }
  if (records.length !== 1)
    fail("stackup", "One pcb_stackup per simulation entry is supported")
  const stackup = pcb_stackup.parse(records[0])
  if (boards.length !== 1 || boards[0].pcb_board_id !== stackup.pcb_board_id)
    fail(
      "stackup",
      `Expected one pcb_board referenced by ${stackup.pcb_board_id}`,
    )
  const layers = stackup.layers.filter(
    (layer) => layer.layer_type !== "soldermask",
  )
  const copper = layers.filter((layer) => layer.layer_type === "copper")
  const matchesLayerCount = copper.length === boards[0].num_layers
  const spansBoard =
    copper[0]?.layer === "top" && copper.at(-1)?.layer === "bottom"
  const distinctLayers =
    new Set(copper.map((layer) => layer.layer)).size === copper.length
  if (!matchesLayerCount || !spansBoard || !distinctLayers) {
    fail(
      "stackup",
      "Copper layers must be distinct, ordered top to bottom, and match pcb_board.num_layers",
    )
  }
  if (
    layers[0]?.layer_type !== "copper" ||
    layers.at(-1)?.layer_type !== "copper"
  )
    fail(
      "stackup",
      "Physical stack must start and end with copper (outside soldermask is ignored)",
    )
  const copperLayers: CopperLayer[] = []
  const dielectrics: DielectricLayer[] = []
  let z = -copper.at(-1)!.thickness
  for (const layer of [...layers].reverse()) {
    const zMinMm = roundLayerPosition(z)
    const zMaxMm = roundLayerPosition(z + layer.thickness)
    z = zMaxMm
    if (layer.layer_type === "copper") {
      copperLayers.push({
        name: layer.layer,
        zMinMm,
        zMaxMm,
        conductivitySm:
          layer.electrical_conductivity_s_per_m ?? defaultCopperConductivitySm,
      })
      continue
    }
    dielectrics.push({
      material: layer.material_name,
      zMinMm,
      zMaxMm,
      relativePermittivity: layer.relative_permittivity,
    })
  }
  for (let i = 1; i < copperLayers.length; i++)
    if (copperLayers[i].zMinMm <= copperLayers[i - 1].zMaxMm)
      fail("stackup", "Copper layers require a positive dielectric gap")
  // Preserve physical layers for the native dielectric interfaces. The weighted
  // value is used only to choose initial timing and mesh settings.
  const thickness = dielectrics.reduce(
    (sum, layer) => sum + layer.zMaxMm - layer.zMinMm,
    0,
  )
  let relativePermittivity: number | undefined
  if (
    thickness > 0 &&
    dielectrics.every((layer) => layer.relativePermittivity !== undefined)
  ) {
    relativePermittivity =
      dielectrics.reduce(
        (sum, layer) =>
          sum + (layer.zMaxMm - layer.zMinMm) * layer.relativePermittivity!,
        0,
      ) / thickness
  }
  return {
    pcbBoardId: stackup.pcb_board_id,
    copperLayers,
    dielectrics,
    relativePermittivity,
    viaPlatingMm: stackup.plated_hole_copper_thickness,
  }
}

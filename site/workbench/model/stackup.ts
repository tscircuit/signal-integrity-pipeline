import { cju } from "@tscircuit/circuit-json-util"
import type { LayerRef, PcbStackup } from "circuit-json"
import { type CircuitJson, stackupFromCircuitJson } from "../../../src/board"
import { calculateRlgc } from "../../../src/rlgc"

/** Copper foil thickness in mm for one ounce per square foot. */
export const copperOunceMm = 0.035
export type StackLayer = PcbStackup["layers"][number]

/** Validate editable material values and replace the workbench board's physical stack. */
export function editStackup({
  circuit,
  layers,
}: {
  circuit: CircuitJson
  layers: StackLayer[]
}): CircuitJson {
  const stackup = cju([...circuit]).pcb_stackup.getWhere({})
  if (!stackup) throw new Error("The board has no PCB stackup.")
  for (const layer of layers) {
    if (layer.layer_type === "soldermask" && layer.thickness === undefined)
      continue
    if (!Number.isFinite(layer.thickness) || layer.thickness! <= 0)
      throw new Error("Layer thickness must be positive.")
    if (
      "relative_permittivity" in layer &&
      layer.relative_permittivity !== undefined &&
      (!Number.isFinite(layer.relative_permittivity) ||
        layer.relative_permittivity < 1)
    )
      throw new Error("Dk must be at least 1.")
    if (
      "loss_tangent" in layer &&
      layer.loss_tangent !== undefined &&
      (!Number.isFinite(layer.loss_tangent) || layer.loss_tangent < 0)
    )
      throw new Error("Df must be nonnegative.")
  }
  const thickness = layers
    .filter((layer) => layer.layer_type !== "soldermask")
    .reduce((sum, layer) => sum + layer.thickness!, 0)
  const next = circuit.map((record) => {
    if (
      record.type === "pcb_stackup" &&
      record.pcb_stackup_id === stackup.pcb_stackup_id
    )
      return { ...record, layers: layers.map((layer) => ({ ...layer })) }
    if (
      record.type === "pcb_board" &&
      record.pcb_board_id === stackup.pcb_board_id
    )
      return { ...record, thickness: Number(thickness.toPrecision(15)) }
    return record
  })
  stackupFromCircuitJson(next)
  return next
}

interface ImpedanceReadout {
  ohms: number
  delayPsPerMm: number
  effectiveDk: number
}

/** Compute an ideal reference-plane cross-section with the browser RLGC calculation. */
export function stackupImpedance({
  circuit,
  signal,
  reference,
  widthMm,
}: {
  circuit: CircuitJson
  signal: LayerRef
  reference?: LayerRef
  widthMm: number
}): ImpedanceReadout {
  const db = cju([...circuit])
  const stack = stackupFromCircuitJson(circuit)
  const conductor = stack.copperLayers.find(({ name }) => name === signal)
  const plane = stack.copperLayers.find(({ name }) => name === reference)
  if (!conductor || !plane || conductor === plane)
    throw new Error("Choose a different reference plane for this signal layer.")
  if (!(widthMm > 0)) throw new Error("Trace width must be positive.")
  const material = db.pcb_stackup
    .getWhere({})!
    .layers.filter((layer) => layer.layer_type === "dielectric")
    .reverse()
  const matrices = calculateRlgc({
    crossSection: {
      conductors: [
        {
          conductorId: signal,
          xMm: 0,
          widthMm,
          zMm: conductor.zMinMm,
          thicknessMm: conductor.zMaxMm - conductor.zMinMm,
          conductivitySm: conductor.conductivitySm,
        },
      ],
      planes: [
        {
          zMm: plane.zMaxMm <= conductor.zMinMm ? plane.zMaxMm : plane.zMinMm,
          conductivitySm: plane.conductivitySm,
        },
      ],
      dielectricLayers: stack.dielectrics.map((layer, index) => {
        if (layer.relativePermittivity === undefined)
          throw new Error(
            "A dielectric layer needs a Dk for the RLGC calculation.",
          )
        return {
          zMm: layer.zMinMm,
          thicknessMm: layer.zMaxMm - layer.zMinMm,
          relativePermittivity: layer.relativePermittivity,
          lossTangent: material[index].loss_tangent ?? 0,
        }
      }),
    },
  })
  const capacitance = matrices.capacitanceFaradsPerMeter[0][0]
  const inductance = matrices.externalInductanceHenriesPerMeter[0][0]
  return {
    ohms: Math.sqrt(inductance / capacitance),
    delayPsPerMm: 1e9 * Math.sqrt(inductance * capacitance),
    effectiveDk: capacitance / matrices.vacuumCapacitanceFaradsPerMeter[0][0],
  }
}

import { cju } from "@tscircuit/circuit-json-util"
import {
  formatCapacitanceSignWarnings,
  parseIbis,
  resolveCoupledPackage,
} from "@tscircuit/ibis-to-spice"
import { getSourcePortConnectivityMapFromCircuitJson } from "../board"
import { type IbisSources, loadModelSource } from "../buffers"
import type { PrunedIbisModels } from "./signal-models"

/** Validate selected package matrices and report their capacitance sign conversions. */
export function channelSimulationPackageWarnings({
  circuit,
  pins,
  sources,
}: PrunedIbisModels & {
  sources: IbisSources
}): string[] {
  const warnings = new Set<string>()
  const connectivity = getSourcePortConnectivityMapFromCircuitJson(circuit)
  const db = cju([...circuit])
  const inspectedPinsByModel = new Map(
    [...pins.values()].map((pin) => [pin.model, pin]),
  )
  for (const ibisModelRecord of db.simulation_ibis_model.list()) {
    const pin = inspectedPinsByModel.get(ibisModelRecord)
    if (!pin || pin.component.coupledPackage === undefined) continue
    const { text, evidence } = loadModelSource({
      model: {
        ...ibisModelRecord,
        pipelineId: ibisModelRecord.simulation_ibis_model_id,
      },
      sources,
    })
    const packagePins = ibisModelRecord.ibis_pin_name_to_source_port_id
    const reducedMatrices = resolveCoupledPackage({
      document: parseIbis(text),
      component: pin.component,
      pins: Object.keys(packagePins),
    })
    for (const [packagePinName, matrixPinName] of Object.entries(
      reducedMatrices?.mergedPins || {},
    )) {
      const packageSourcePortId = packagePins[packagePinName]
      const matrixSourcePortId = packagePins[matrixPinName]
      if (!matrixSourcePortId) continue
      const packageNet =
        connectivity.getNetConnectedToId(packageSourcePortId) ||
        packageSourcePortId
      const matrixNet =
        connectivity.getNetConnectedToId(matrixSourcePortId) ||
        matrixSourcePortId
      if (packageNet !== matrixNet)
        throw new Error(
          `${ibisModelRecord.ibis_component_name}: merged package pins ${packagePinName} and ${matrixPinName} require the same board net`,
        )
    }
    const file = ibisModelRecord.ibis_model_asset.project_relative_path
    for (const warning of formatCapacitanceSignWarnings({
      selected: reducedMatrices,
      file,
      sourceSha256: evidence.sourceSha256,
    }))
      warnings.add(warning)
  }
  return [...warnings]
}

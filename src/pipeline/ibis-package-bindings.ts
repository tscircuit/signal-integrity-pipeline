import {
  formatCapacitanceSignWarnings,
  resolveCoupledPackage,
} from "@tscircuit/ibis-to-spice"
import { type ConnectivityMap, sourceNetMembers } from "../board"
import type { InspectedPins } from "../buffers"

/** First mapped pin and board net for one package matrix pin. */
interface MappedPackageRail {
  packagePinName: string
  netMembers: ReturnType<typeof sourceNetMembers>
}

/** Reject mapped rail pins that would join distinct board nets at one package branch. */
function validateMergedRailNets({
  connectivity,
  sourcePortIdByPackagePinName,
  mergedPins,
  componentName,
}: {
  connectivity: ConnectivityMap
  sourcePortIdByPackagePinName: Readonly<Record<string, string>>
  mergedPins: Readonly<Record<string, string>>
  componentName: string
}): void {
  const railsByMatrixPinName = new Map<string, MappedPackageRail>()
  for (const [packagePinName, matrixPinName] of Object.entries(mergedPins)) {
    let rail = railsByMatrixPinName.get(matrixPinName)
    if (rail === undefined) {
      let firstMappedPinName = matrixPinName
      if (sourcePortIdByPackagePinName[matrixPinName] === undefined)
        firstMappedPinName = packagePinName
      rail = {
        packagePinName: firstMappedPinName,
        netMembers: sourceNetMembers({
          connectivity,
          memberId: sourcePortIdByPackagePinName[firstMappedPinName],
        }),
      }
      railsByMatrixPinName.set(matrixPinName, rail)
    }
    if (!rail.netMembers.has(sourcePortIdByPackagePinName[packagePinName]))
      throw new Error(
        `${componentName}: merged package pins ${packagePinName} and ${rail.packagePinName} require the same board net`,
      )
  }
}

/** Validate mapped packages against board nets and return capacitance sign warnings. */
export function validateIbisPackageBindings({
  pins,
  connectivity,
}: {
  pins: InspectedPins
  connectivity: ConnectivityMap
}): string[] {
  const warnings = new Set<string>()
  const inspectedPinsByModel = new Map(
    [...pins.values()].map((pin) => [pin.model, pin]),
  )
  for (const [model, inspectedPin] of inspectedPinsByModel) {
    const { component, ibisSource } = inspectedPin
    if (component.coupledPackage === undefined) continue
    const sourcePortIdByPackagePinName = model.ibis_pin_name_to_source_port_id
    const coupledPackage = resolveCoupledPackage({
      document: ibisSource.document,
      component,
      pins: Object.keys(sourcePortIdByPackagePinName),
    })
    if (coupledPackage === undefined) continue
    validateMergedRailNets({
      connectivity,
      sourcePortIdByPackagePinName,
      mergedPins: coupledPackage.mergedPins,
      componentName: model.ibis_component_name,
    })
    const ibisAssetPath = model.ibis_model_asset.project_relative_path
    for (const warning of formatCapacitanceSignWarnings({
      selected: coupledPackage,
      file: ibisAssetPath,
      sourceSha256: ibisSource.sourceSha256,
    }))
      warnings.add(warning)
  }
  return [...warnings]
}

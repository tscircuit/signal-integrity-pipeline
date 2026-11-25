import {
  cornerValue,
  type IbisCorner,
  type IbisDocument,
  resolveIbisReferenceVoltages,
} from "@tscircuit/ibis-to-spice"
import type { SourcePortId } from "../board"
import type { ConvertedIbisComponent } from "./types"

/** Maximum mismatch between nominal voltages on one die rail. */
export const DIE_VOLTAGE_TOLERANCE_VOLTS = 1e-8

/** Nominal rail bias and pulldown reference for one source port. */
interface RailReference {
  voltageVolts?: number
  pulldownSourcePortIds: Set<SourcePortId>
}

/** Resolve the nominal rail bias and ground connections for each die buffer. */
export function resolveRailReferences({
  pins,
  document,
  corner,
}: {
  pins: ConvertedIbisComponent["metadata"]["pins"]
  document: IbisDocument
  corner: IbisCorner
}): Map<SourcePortId, RailReference> {
  const rails = new Map<SourcePortId, RailReference>()
  for (const pin of pins) {
    const buffer = document.getBuffer(pin.model)
    const voltages = resolveIbisReferenceVoltages({ buffer, corner })
    for (const role of Object.keys(pin.references) as Array<
      keyof typeof pin.references
    >) {
      const sourcePortId = pin.references[role]
      if (sourcePortId === undefined) continue
      let voltageVolts: number | undefined
      if (role !== "external") voltageVolts = voltages[role]
      if (role === "external" && buffer.externalReference !== undefined)
        voltageVolts = cornerValue(
          buffer.externalReference,
          corner,
          "external reference",
        )
      const previous = rails.get(sourcePortId)
      if (
        previous?.voltageVolts !== undefined &&
        voltageVolts !== undefined &&
        Math.abs(previous.voltageVolts - voltageVolts) >
          DIE_VOLTAGE_TOLERANCE_VOLTS
      ) {
        throw new Error(`${sourcePortId}: incompatible IBIS die voltages`)
      }
      if (voltageVolts === undefined) voltageVolts = previous?.voltageVolts
      rails.set(sourcePortId, {
        voltageVolts,
        pulldownSourcePortIds: new Set([
          ...(previous?.pulldownSourcePortIds || []),
          pin.references.pulldown,
        ]),
      })
    }
  }
  return rails
}

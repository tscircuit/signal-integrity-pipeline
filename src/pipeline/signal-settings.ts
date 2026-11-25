import { type CircuitJson, stackupFromCircuitJson } from "../board"
import type { IbisSources } from "../buffers"
import type { NumericalSettings } from "./modeling"
import { retainedPassiveComponents } from "./signal-loads"
import type { PrunedIbisModels } from "./signal-models"
import { channelSimulationPackageWarnings } from "./signal-package-warnings"
import type { ScopedSignalPins, SignalPins } from "./signal-pins"
import { withChannelSimulationSupplies } from "./supplies"

/** Numerical settings and the pruned circuit with its supplies. */
interface SuppliedSignalSettings {
  circuit: CircuitJson
  settings: NumericalSettings
  warnings: string[]
}

/** Check the stackup and prepare numerical settings with supplies and retained loads. */
export function prepareSignalSettings({
  pruned,
  signalPins,
  scopedPins,
  traceContacts,
  sources,
}: {
  pruned: PrunedIbisModels
  signalPins: Pick<SignalPins, "connectivity" | "rails" | "reference">
  scopedPins: Pick<ScopedSignalPins, "copperScope" | "retained">
  traceContacts: NumericalSettings["traceContacts"]
  sources: IbisSources
}): SuppliedSignalSettings {
  const { connectivity, rails, reference } = signalPins
  const { copperScope, retained } = scopedPins
  const warnings = channelSimulationPackageWarnings({ ...pruned, sources })
  const stack = stackupFromCircuitJson(pruned.circuit)
  if (!stack.relativePermittivity) {
    throw new Error(
      "<simulation.pcbtransientchannelsimulation> needs explicit stackup dielectric constants.",
    )
  }
  if (copperScope.extractedPcbViaIds.length && !stack.viaPlatingMm) {
    throw new Error(
      "pcb_stackup must specify plated_hole_copper_thickness for routed vias",
    )
  }
  const settings: NumericalSettings = {
    traceContacts,
    copperScope,
    channelReference: { sourcePortId: reference },
  }
  const { circuit, supplies } = withChannelSimulationSupplies({
    ...pruned,
    connectivity,
    retained,
    reference,
  })
  if (supplies.length) settings.supplies = supplies
  settings.passiveComponents = retainedPassiveComponents({
    circuit,
    copperScope,
    pins: pruned.pins,
    retained,
    rails,
  })
  return { circuit, settings, warnings }
}

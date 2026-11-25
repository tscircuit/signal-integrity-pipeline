import { parseIbis } from "@tscircuit/ibis-to-spice"
import { sha256 } from "../kernel"
import {
  type CoupledPackageModel,
  comparePinPackageTerms,
  formatCapacitanceSignWarnings,
  resolveCoupledPackage,
} from "./coupled-package"
import {
  buildPackageCapacitances,
  buildPackageNetwork,
  resolvePackageTerminals,
} from "./package-network"
import { resolveRailReferences } from "./package-rails"
import { withPackageElements } from "./spice-netlist"
import { convertIbisComponentWithSwitchingSchedule } from "./switching-conversion"
import type { ConvertedIbisComponent, ModelRunDefinition } from "./types"

const UNUSED_PIN_POLICY = "open-series-floating-capacitance"

const COUPLED_PACKAGE_WARNING = [
  "Coupled package: zero series current and floating capacitance at unused pins.",
  "One lumped pi section represents each matrix pin.",
  "Other pins use [Pin] or [Package] values, or share the branch for a merged rail bus.",
].join(" ")

/** Rebuild package evidence without changing the upstream converter's records. */
function buildPackageMetadata({
  metadata,
  coupled,
}: {
  metadata: ConvertedIbisComponent["metadata"]
  coupled?: CoupledPackageModel
}): ConvertedIbisComponent["metadata"] {
  const result = {
    ...metadata,
    packagePolicy: "vendor" as const,
    omissions: [],
  }
  if (!coupled) return result
  return {
    ...result,
    packageData: {
      ...metadata.packageData,
      matrices: coupled,
      unusedPinPolicy: UNUSED_PIN_POLICY,
      mappedPins: metadata.packageData.mappedPins.map((pin) => {
        const index = coupled.activePins.indexOf(
          coupled.mergedPins[pin.physicalPin] || pin.physicalPin,
        )
        if (index < 0) return pin
        return {
          ...pin,
          resistanceOhms: coupled.R[index][index],
          inductanceHenries: coupled.L[index][index],
          capacitanceFarads: coupled.C[index][index],
        }
      }),
    },
  }
}

/** Convert IBIS die buffers and apply the requested package policy. */
export function convertIbisComponentWithPackage({
  bytes,
  input,
  sourceFile,
}: {
  bytes: Uint8Array
  input: ModelRunDefinition
  sourceFile?: string
}): ConvertedIbisComponent {
  const { corner, packagePolicy } = input.definition
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  const document = parseIbis(text)
  const component = document.components[input.definition.component]
  if (!component)
    throw new Error(`Missing IBIS component ${input.definition.component}`)
  if (packagePolicy !== "vendor" && packagePolicy !== "omit")
    throw new Error("Select an explicit IBIS package policy")
  const converted = convertIbisComponentWithSwitchingSchedule({
    bytes,
    input,
    document,
  })
  if (packagePolicy === "omit") return converted
  const terminals = resolvePackageTerminals(converted)
  const physicalPins = terminals.flatMap(({ packagePinName }) =>
    packagePinName === undefined ? [] : [packagePinName],
  )
  const coupled = resolveCoupledPackage({ text, component, pins: physicalPins })
  const railReferences = resolveRailReferences({
    pins: converted.metadata.pins,
    document,
    corner,
  })
  const network = buildPackageNetwork({
    terminals,
    coupled,
    component,
    corner,
    references: railReferences,
  })
  const nodes = new Map(
    terminals.flatMap(({ boardSpiceNode, sourcePortId }) => {
      const dieSpiceNode = network.dieSpiceNodes.get(sourcePortId)
      if (dieSpiceNode === undefined) return []
      return [[boardSpiceNode, dieSpiceNode] as const]
    }),
  )
  const source = withPackageElements({
    source: converted.source,
    nodes,
    elements: [
      ...network.elements,
      ...buildPackageCapacitances({
        terminals,
        network,
        converted,
        coupled,
        railReferences,
      }),
    ],
  })
  const metadata = buildPackageMetadata({
    metadata: converted.metadata,
    coupled,
  })
  const warnings = converted.warnings.filter(
    (warning) => !converted.metadata.omissions.includes(warning),
  )
  warnings.push(
    "Vendor package parasitics applied. Die voltage sources bias rail branches with DC resistance.",
  )
  if (coupled)
    warnings.push(
      COUPLED_PACKAGE_WARNING,
      ...comparePinPackageTerms({ component, selected: coupled }),
      ...formatCapacitanceSignWarnings({
        selected: coupled,
        file: sourceFile || input.definition.source.file || "(inline IBIS)",
        sourceSha256: sha256(bytes),
      }),
    )
  return { ...converted, source, metadata, warnings }
}

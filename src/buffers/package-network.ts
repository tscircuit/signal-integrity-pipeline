import type { IbisComponent, IbisCorner } from "@tscircuit/ibis-to-spice"
import type { SourcePortId } from "../board"
import {
  buildCoupledPackageSpiceElements,
  type CoupledPackageModel,
  PI_SECTION_SHUNT_COUNT,
} from "./coupled-package"
import { buildPackageBranch, type PackageBranch } from "./package-branch"
import {
  DIE_VOLTAGE_TOLERANCE_VOLTS,
  type resolveRailReferences,
} from "./package-rails"
import type { SpiceNode } from "./spice-netlist"
import type { ConvertedIbisComponent } from "./types"

/** Physical pin label from the component [Pin] table. */
type PackagePinName = keyof IbisComponent["pins"]

/** Circuit JSON port and physical pin corresponding to a SPICE wrapper terminal. */
export interface PackageTerminal {
  boardSpiceNode: SpiceNode
  sourcePortId: SourcePortId
  packagePinName?: PackagePinName
}

/** Package branches and the node remapping for die buffers. */
interface PackageNetwork {
  branches: Map<PackagePinName, PackageBranch>
  dieSpiceNodes: Map<SourcePortId, SpiceNode>
  elements: string[]
}

/** Resolve wrapper terminals independently of physical package pins. */
export function resolvePackageTerminals(
  converted: ConvertedIbisComponent,
): PackageTerminal[] {
  return Object.entries(converted.spicePinMapping).map(
    ([boardSpiceNode, sourcePortId]) => ({
      boardSpiceNode,
      sourcePortId,
      packagePinName: converted.metadata.packageData.mappedPins.find(
        (pin) => pin.port === sourcePortId,
      )?.physicalPin,
    }),
  )
}

/** Pick one external terminal for each package branch, prioritizing its matrix pin. */
export function buildPackageNetwork({
  terminals,
  coupled,
  component,
  corner,
  references,
}: {
  terminals: PackageTerminal[]
  coupled?: CoupledPackageModel
  component: IbisComponent
  corner: IbisCorner
  references: ReturnType<typeof resolveRailReferences>
}): PackageNetwork {
  const branches = new Map<PackagePinName, PackageBranch>()
  const dieSpiceNodes = new Map<SourcePortId, SpiceNode>()
  const elements: string[] = []
  const mergedVoltages = new Map<PackagePinName, number>()
  for (const [index, terminal] of terminals.entries()) {
    const { packagePinName, sourcePortId, boardSpiceNode } = terminal
    if (packagePinName === undefined) {
      dieSpiceNodes.set(sourcePortId, boardSpiceNode)
      continue
    }
    const matrixPinName = coupled?.mergedPins[packagePinName] || packagePinName
    const railVoltageVolts = references.get(sourcePortId)?.voltageVolts
    const previous = mergedVoltages.get(matrixPinName)
    if (railVoltageVolts !== undefined) {
      if (
        previous !== undefined &&
        Math.abs(previous - railVoltageVolts) > DIE_VOLTAGE_TOLERANCE_VOLTS
      )
        throw new Error(
          `${component.name}: incompatible die voltages on merged package pin ${matrixPinName}`,
        )
      mergedVoltages.set(matrixPinName, railVoltageVolts)
    }
    if (branches.has(matrixPinName)) continue
    const canonicalTerminal = terminals.find(
      (entry) => entry.packagePinName === matrixPinName,
    )
    const branch = buildPackageBranch({
      terminal: canonicalTerminal?.boardSpiceNode || boardSpiceNode,
      packagePinName: canonicalTerminal?.packagePinName || packagePinName,
      index,
      matrixPinName,
      component,
      corner,
      coupled,
      railVoltageVolts,
    })
    branches.set(matrixPinName, branch)
    elements.push(...branch.elements)
  }
  for (const { sourcePortId, packagePinName } of terminals) {
    if (packagePinName === undefined) continue
    const branch = branches.get(
      coupled?.mergedPins[packagePinName] || packagePinName,
    )
    if (!branch) throw new Error(`${packagePinName}: missing package branch`)
    dieSpiceNodes.set(sourcePortId, branch.dieSpiceNode)
  }
  return { branches, dieSpiceNodes, elements }
}

/** Obtain a shared pulldown node when one exists. The matrix reference is global for multiple banks. */
function resolveCapacitanceGround(
  groundSpiceNodes: Array<SpiceNode | undefined>,
): SpiceNode {
  const nodes = new Set(groundSpiceNodes)
  const [groundSpiceNode] = nodes
  if (nodes.size === 1 && groundSpiceNode !== undefined) return groundSpiceNode
  return "0"
}

/** Attach the matrix and pin-level shunts to their electrical reference. */
export function buildPackageCapacitances({
  terminals,
  network,
  converted,
  coupled,
  railReferences,
}: {
  terminals: PackageTerminal[]
  network: PackageNetwork
  converted: ConvertedIbisComponent
  coupled?: CoupledPackageModel
  railReferences: ReturnType<typeof resolveRailReferences>
}): string[] {
  const pins = converted.metadata.pins
  const { dieSpiceNodes, branches } = network
  const ground = resolveCapacitanceGround(
    pins.map((pin) => dieSpiceNodes.get(pin.references.pulldown)),
  )
  const elements: string[] = []
  for (const [index, { packagePinName, sourcePortId }] of terminals.entries()) {
    if (packagePinName === undefined) continue
    const branch = branches.get(packagePinName)
    if (!branch || branch.capacitanceFarads === 0) continue
    const signalPin = pins.find((pin) => pin.port === sourcePortId)
    const pulldownSourcePortIds =
      railReferences.get(sourcePortId)?.pulldownSourcePortIds
    let reference = ground
    if (signalPin)
      reference = resolveCapacitanceGround([
        dieSpiceNodes.get(signalPin.references.pulldown),
      ])
    if (pulldownSourcePortIds)
      reference = resolveCapacitanceGround(
        [...pulldownSourcePortIds].map((id) => dieSpiceNodes.get(id)),
      )
    let prefix = "CPKG"
    if (coupled) prefix = "CPKGU"
    const halfCapacitanceFarads =
      branch.capacitanceFarads / PI_SECTION_SHUNT_COUNT
    elements.push(
      `${prefix}${index}a ${branch.boardSpiceNode} ${reference} ${halfCapacitanceFarads}`,
      `${prefix}${index}b ${branch.seriesEndSpiceNode} ${reference} ${halfCapacitanceFarads}`,
    )
  }
  if (!coupled) return elements
  const matrixBranches = coupled.activePins.map((pin) => {
    const branch = branches.get(pin)
    if (!branch) throw new Error(`${pin}: missing package matrix branch`)
    return branch
  })
  return [
    ...elements,
    ...buildCoupledPackageSpiceElements({
      matrices: coupled,
      terminals: matrixBranches.map((branch) => branch.boardSpiceNode),
      die: matrixBranches.map((branch) => branch.seriesEndSpiceNode),
      ground,
    }),
  ]
}

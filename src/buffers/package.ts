import {
  cornerValue,
  type IbisComponent,
  type IbisCorner,
  parseIbis,
} from "@tscircuit/ibis-to-spice"
import type { SourcePortId } from "../board"
import { sha256 } from "../kernel"
import {
  type CoupledPackageModel,
  coupledPackage,
  coupledPackageElements,
  PACKAGE_SHUNT_COUNT,
  packageCapacitanceWarnings,
  packageComparisons,
} from "./coupled-package"
import {
  DIE_VOLTAGE_TOLERANCE_VOLTS,
  resolveRailReferences,
} from "./package-rails"
import { convertSwitching } from "./switching"
import { isSpace, tokenEnd } from "./text"
import type { ModelRunDefinition, PackagedComponent } from "./types"

/** SPICE node name in the package subcircuit. */
type SpiceNode = string

/** Circuit JSON port and physical pin corresponding to a SPICE wrapper terminal. */
interface PackageTerminal {
  boardSpiceNode: SpiceNode
  sourcePortId: SourcePortId
  packagePinName?: string
}

/** R/L/C parasitics at one package pin. */
interface PinPackageTerms {
  resistanceOhms: number
  inductanceHenries: number
  capacitanceFarads: number
}

/** Board-to-die series branch endpoints and the die buffer's electrical node. */
interface PackageBranch {
  boardSpiceNode: SpiceNode
  seriesEndSpiceNode: SpiceNode
  dieSpiceNode: SpiceNode
  elements: string[]
  capacitanceFarads: number
}

/** Package branches and the node remapping for die buffers. */
interface PackageNetwork {
  branches: Map<string, PackageBranch>
  dieSpiceNodes: Map<SourcePortId, SpiceNode>
  elements: string[]
}

const UNUSED_PIN_POLICY = "open-series-floating-capacitance"

const COUPLED_PACKAGE_WARNING = [
  "Coupled package: zero series current and floating capacitance at unused pins.",
  "One lumped pi section represents each matrix pin.",
  "Other pins use [Pin] or [Package] values, or share the branch for a merged rail bus.",
].join(" ")

/** Remap whole SPICE tokens while preserving whitespace. */
function remapNodes({
  line,
  nodes,
}: {
  line: string
  nodes: ReadonlyMap<SpiceNode, SpiceNode>
}): string {
  let source = ""
  for (let start = 0; start < line.length; ) {
    if (isSpace(line[start])) {
      source += line[start]
      start++
      continue
    }
    const end = tokenEnd({ text: line, start })
    const token = line.slice(start, end)
    source += nodes.get(token) || token
    start = end
  }
  return source
}

/** Resolve wrapper terminals independently of physical package pins. */
function resolvePackageTerminals(
  converted: PackagedComponent,
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

/** Minimum/maximum values follow the pinned converter's corner validation. */
function readPackageTerm({
  component,
  packagePinName,
  corner,
  field,
}: {
  component: IbisComponent
  packagePinName: string
  corner: IbisCorner
  field: "resistance" | "inductance" | "capacitance"
}): number {
  const byPin = component.pins[packagePinName][field]
  const byCorner = component.package[field]
  const label = `${packagePinName}: vendor package ${field}`
  let term = byPin
  if (term === undefined && byCorner !== undefined)
    term = cornerValue(byCorner, corner, label)
  if (term == null || !Number.isFinite(term) || term < 0)
    throw new Error(`${label} requires a finite nonnegative term`)
  return term
}

/** Read scalar parasitics only when this pin lacks matrix entries. */
function readPinPackageTerms(input: {
  component: IbisComponent
  packagePinName: string
  corner: IbisCorner
}): PinPackageTerms {
  return {
    resistanceOhms: readPackageTerm({ ...input, field: "resistance" }),
    inductanceHenries: readPackageTerm({ ...input, field: "inductance" }),
    capacitanceFarads: readPackageTerm({ ...input, field: "capacitance" }),
  }
}

/** Add a die voltage source only when its series path has nonzero DC resistance. */
function resolveDieNode({
  index,
  elements,
  seriesEndSpiceNode,
  resistanceOhms,
  railVoltageVolts,
}: {
  index: number
  elements: string[]
  seriesEndSpiceNode: SpiceNode
  resistanceOhms: number
  railVoltageVolts?: number
}): SpiceNode {
  if (railVoltageVolts === undefined || resistanceOhms === 0)
    return seriesEndSpiceNode
  const dieSpiceNode = `DIE${index}`
  elements.push(
    `VDIE${index} ${dieSpiceNode} 0 ${railVoltageVolts}`,
    `VPKG${index} ${seriesEndSpiceNode} ${dieSpiceNode} 0`,
  )
  return dieSpiceNode
}

/** Construct the unique series branch for one scalar or matrix pin. */
function buildPackageBranch({
  terminal,
  packagePinName,
  matrixPinName,
  index,
  component,
  corner,
  coupled,
  railVoltageVolts,
}: {
  terminal: SpiceNode
  packagePinName: string
  matrixPinName: string
  index: number
  component: IbisComponent
  corner: IbisCorner
  coupled?: CoupledPackageModel
  railVoltageVolts?: number
}): PackageBranch {
  const elements: string[] = []
  const matrixIndex = coupled?.pins.indexOf(matrixPinName)
  let boardSpiceNode = terminal
  let seriesEndSpiceNode = terminal
  let resistanceOhms: number
  let capacitanceFarads = 0
  if (coupled && matrixIndex !== undefined && matrixIndex >= 0) {
    if (matrixPinName !== packagePinName) {
      boardSpiceNode = `PKGM${index}`
      elements.push(`VPKGM${index} ${terminal} ${boardSpiceNode} 0`)
    }
    seriesEndSpiceNode = `PKGD${matrixIndex}`
    resistanceOhms = coupled.R[matrixIndex][matrixIndex]
  } else {
    const terms = readPinPackageTerms({ component, packagePinName, corner })
    resistanceOhms = terms.resistanceOhms
    capacitanceFarads = terms.capacitanceFarads
    let prefix = `PKG`
    if (coupled) prefix = `PKGU`
    if (resistanceOhms > 0) {
      seriesEndSpiceNode = `${prefix}R${index}`
      elements.push(
        `R${prefix}${index} ${terminal} ${seriesEndSpiceNode} ${resistanceOhms}`,
      )
    }
    if (terms.inductanceHenries > 0) {
      const nextSpiceNode = `${prefix}L${index}`
      elements.push(
        `L${prefix}${index} ${seriesEndSpiceNode} ${nextSpiceNode} ${terms.inductanceHenries}`,
      )
      seriesEndSpiceNode = nextSpiceNode
    }
  }
  const dieSpiceNode = resolveDieNode({
    index,
    elements,
    seriesEndSpiceNode,
    resistanceOhms,
    railVoltageVolts,
  })
  return {
    boardSpiceNode,
    seriesEndSpiceNode,
    dieSpiceNode,
    capacitanceFarads,
    elements,
  }
}

/** Pick one external terminal for each package branch, prioritizing its matrix pin. */
function buildPackageNetwork({
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
  const branches = new Map<string, PackageBranch>()
  const dieSpiceNodes = new Map<SourcePortId, SpiceNode>()
  const elements: string[] = []
  const mergedVoltages = new Map<string, number>()
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
function buildPackageCapacitances({
  terminals,
  network,
  converted,
  coupled,
  railReferences,
}: {
  terminals: PackageTerminal[]
  network: PackageNetwork
  converted: PackagedComponent
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
    const halfCapacitanceFarads = branch.capacitanceFarads / PACKAGE_SHUNT_COUNT
    elements.push(
      `${prefix}${index}a ${branch.boardSpiceNode} ${reference} ${halfCapacitanceFarads}`,
      `${prefix}${index}b ${branch.seriesEndSpiceNode} ${reference} ${halfCapacitanceFarads}`,
    )
  }
  if (!coupled) return elements
  const matrixBranches = coupled.pins.map((pin) => {
    const branch = branches.get(pin)
    if (!branch) throw new Error(`${pin}: missing package matrix branch`)
    return branch
  })
  return [
    ...elements,
    ...coupledPackageElements({
      matrices: coupled,
      terminals: matrixBranches.map((branch) => branch.boardSpiceNode),
      die: matrixBranches.map((branch) => branch.seriesEndSpiceNode),
      ground,
    }),
  ]
}

/** Rebuild package evidence without changing the upstream converter's records. */
function buildPackageMetadata({
  metadata,
  coupled,
}: {
  metadata: PackagedComponent["metadata"]
  coupled?: CoupledPackageModel
}): PackagedComponent["metadata"] {
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
        const index = coupled.pins.indexOf(
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

/** Attach package elements and remap the die-buffer instances inside the wrapper. */
function withPackageElements({
  source,
  nodes,
  elements,
}: {
  source: string
  nodes: ReadonlyMap<SpiceNode, SpiceNode>
  elements: string[]
}): string {
  const lines = source.split("\n")
  const wrapperStartIndex = lines.findIndex((line) =>
    line.toLowerCase().startsWith(".subckt "),
  )
  const wrapperEndIndex = lines.findIndex((line) =>
    line.toLowerCase().startsWith(".ends "),
  )
  if (wrapperStartIndex < 0 || wrapperEndIndex <= wrapperStartIndex)
    throw new Error("Missing IBIS wrapper subcircuit")
  const wrapper = lines.slice(wrapperStartIndex + 1, wrapperEndIndex)
  return [
    ...lines.slice(0, wrapperStartIndex + 1),
    ...wrapper.map((line) => remapNodes({ line, nodes })),
    ...elements,
    ...lines.slice(wrapperEndIndex),
  ].join("\n")
}

/** Convert IBIS die buffers and apply the requested package policy. */
export function convertPackaged({
  bytes,
  input,
  sourceFile,
}: {
  bytes: Uint8Array
  input: ModelRunDefinition
  sourceFile?: string
}): PackagedComponent {
  const { corner, packagePolicy } = input.definition
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  const document = parseIbis(text)
  const component = document.components[input.definition.component]
  if (!component)
    throw new Error(`Missing IBIS component ${input.definition.component}`)
  if (packagePolicy !== "vendor" && packagePolicy !== "omit")
    throw new Error("Select an explicit IBIS package policy")
  const converted = convertSwitching({ bytes, input, document })
  if (packagePolicy === "omit") return converted
  const terminals = resolvePackageTerminals(converted)
  const physicalPins = terminals.flatMap(({ packagePinName }) =>
    packagePinName === undefined ? [] : [packagePinName],
  )
  const coupled = coupledPackage({ text, component, pins: physicalPins })
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
      ...packageComparisons({ component, selected: coupled }),
      ...packageCapacitanceWarnings({
        selected: coupled,
        file: sourceFile || input.definition.source.file || "(inline IBIS)",
        sourceSha256: sha256(bytes),
      }),
    )
  return { ...converted, source, metadata, warnings }
}

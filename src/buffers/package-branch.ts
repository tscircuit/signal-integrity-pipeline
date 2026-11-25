import {
  cornerValue,
  type IbisComponent,
  type IbisCorner,
} from "@tscircuit/ibis-to-spice"
import type { CoupledPackageModel } from "./coupled-package"
import type { SpiceNode } from "./spice-netlist"

/** R/L/C parasitics at one package pin. */
interface PinPackageTerms {
  resistanceOhms: number
  inductanceHenries: number
  capacitanceFarads: number
}

/** Board-to-die series branch endpoints and the die buffer's electrical node. */
export interface PackageBranch {
  boardSpiceNode: SpiceNode
  seriesEndSpiceNode: SpiceNode
  dieSpiceNode: SpiceNode
  elements: string[]
  capacitanceFarads: number
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
export function buildPackageBranch({
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
  const matrixIndex = coupled?.activePins.indexOf(matrixPinName)
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

import type { CoupledPackageModel } from "./coupled-package"
import type { SpiceNode } from "./spice-netlist"
import type { PackageConversionMetadata } from "./types"

/** Upstream has already applied the selected corner and per-pin overrides. */
export type PinPackageTerms =
  PackageConversionMetadata["packageData"]["mappedPins"][number]

/** Board-to-die series branch endpoints and the die buffer's electrical node. */
export interface PackageBranch {
  boardSpiceNode: SpiceNode
  seriesEndSpiceNode: SpiceNode
  dieSpiceNode: SpiceNode
  elements: string[]
  capacitanceFarads: number
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
  terms,
  coupled,
  railVoltageVolts,
}: {
  terminal: SpiceNode
  packagePinName: string
  matrixPinName: string
  index: number
  terms: PinPackageTerms | undefined
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
    if (
      !terms ||
      terms.resistanceOhms === null ||
      terms.inductanceHenries === null ||
      terms.capacitanceFarads === null ||
      ![
        terms.resistanceOhms,
        terms.inductanceHenries,
        terms.capacitanceFarads,
      ].every((value) => Number.isFinite(value) && value >= 0)
    )
      throw new Error(
        `${packagePinName}: complete nonnegative vendor package R/L/C required`,
      )
    const { inductanceHenries } = terms
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
    if (inductanceHenries > 0) {
      const nextSpiceNode = `${prefix}L${index}`
      elements.push(
        `L${prefix}${index} ${seriesEndSpiceNode} ${nextSpiceNode} ${inductanceHenries}`,
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

import type { TraceWire, WireSection } from "../board"
import type { Snapshot } from "../kernel"
import type { RlgcMatrices } from "./cross-section"

/** A pair is coupled when either normalized mutual reaches 0.5%. */
const COUPLING_THRESHOLD = 0.005

type WireIndex = TraceWire["wireIndex"]

/** The pair's normalized mutuals and decision in its source wire section. */
export interface PairCoupling {
  wireSectionIndex: number
  wireIndices: readonly [WireIndex, WireIndex]
  normalizedMutualCapacitance: number
  normalizedMutualInductance: number
  isCoupled: boolean
}

/** Compute the dimensionless magnitude of the mutual between two conductors. */
function normalizeMutual(matrix: Snapshot<number[][]>): number {
  return Math.abs(matrix[0][1]) / Math.sqrt(matrix[0][0] * matrix[1][1])
}

/** Screen a pair with the same inclusive threshold for electric and magnetic coupling. */
export function screenWirePair({
  wireSectionIndex,
  wireIndices,
  rlgcMatrices,
}: {
  wireSectionIndex: number
  wireIndices: PairCoupling["wireIndices"]
  rlgcMatrices: Snapshot<RlgcMatrices>
}): PairCoupling {
  const normalizedMutualCapacitance = normalizeMutual(
    rlgcMatrices.capacitanceFaradsPerMeter,
  )
  const normalizedMutualInductance = normalizeMutual(
    rlgcMatrices.externalInductanceHenriesPerMeter,
  )
  return {
    wireSectionIndex,
    wireIndices,
    normalizedMutualCapacitance,
    normalizedMutualInductance,
    isCoupled:
      Math.max(normalizedMutualCapacitance, normalizedMutualInductance) >=
      COUPLING_THRESHOLD,
  }
}

/** Follow parent links to a coupled group's representative. */
function findGroup({
  parents,
  wireIndex,
}: {
  parents: ReadonlyMap<WireIndex, WireIndex>
  wireIndex: WireIndex
}): WireIndex {
  let groupIndex = wireIndex
  let parentIndex = parents.get(groupIndex)
  while (parentIndex !== undefined) {
    groupIndex = parentIndex
    parentIndex = parents.get(groupIndex)
  }
  return groupIndex
}

/** Group transitively coupled wires in their original order. */
export function groupCoupledWires({
  wireSection,
  pairCouplings,
}: {
  wireSection: Snapshot<WireSection>
  pairCouplings: readonly PairCoupling[]
}): Snapshot<WireSection>[] {
  const parents = new Map<WireIndex, WireIndex>()
  for (const { wireIndices, isCoupled } of pairCouplings) {
    if (!isCoupled) continue
    const firstGroup = findGroup({ parents, wireIndex: wireIndices[0] })
    const secondGroup = findGroup({ parents, wireIndex: wireIndices[1] })
    if (firstGroup !== secondGroup) parents.set(secondGroup, firstGroup)
  }
  const groups = new Map<WireIndex, Snapshot<TraceWire>[]>()
  for (const wire of wireSection.wires) {
    const groupIndex = findGroup({ parents, wireIndex: wire.wireIndex })
    const wires = groups.get(groupIndex)
    if (wires) wires.push(wire)
    else groups.set(groupIndex, [wire])
  }
  return Array.from(groups.values(), (wires) => ({ ...wireSection, wires }))
}

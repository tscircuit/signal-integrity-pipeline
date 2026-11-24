import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  type CopperGeometry,
  cloneCircuitJson,
  type PcbTrace,
  type WireSection,
} from "../board"
import { type Produced, rootScope, type Snapshot, snapshot } from "../kernel"
import {
  type CrossSection,
  calculateRlgc,
  type RlgcMatrices,
  resolvePanelsPerEdge,
} from "./cross-section"
import {
  type DielectricMaterials,
  type MaskThicknessSource,
  resolveMaterials,
} from "./dielectric-materials"
import type {
  CrossSectionKey,
  CrossSectionSolution,
  SolvedWireSection,
  TransmissionLineRlgc,
} from "./transmission-line-rlgc-types"
import { drawTransmissionLineRlgc } from "./transmission-line-rlgc-visual"
import {
  groupCoupledWires,
  type PairCoupling,
  screenWirePair,
} from "./wire-coupling"
import { buildCrossSection } from "./wire-cross-section"

const PARALLEL_COUPLING_WARNING = [
  "Wires are coupled when normalized mutual capacitance or inductance reaches 0.5%.",
  "Pair screening does not bound aggregate waveform error.",
  "The copper scope and adjacent-layer model limit which interactions are considered.",
].join(" ")

/** Copper geometry, material overrides, and the artifact location. */
export interface TransmissionLineRlgcInput {
  readonly copperGeometry: Snapshot<CopperGeometry>
  readonly materials?: DielectricMaterials
  readonly panelsPerEdge?: number
  readonly artifactPrefix: string
}

/** A wire pair or coupled wire group tied to its input section. */
interface IndexedWireSection {
  wireSectionIndex: number
  wireSection: Snapshot<WireSection>
}

/** Enumerate pairs incrementally without allocating an entire work queue. */
function* enumerateWirePairs(
  wireSections: readonly Snapshot<WireSection>[],
): IterableIterator<IndexedWireSection> {
  for (const [wireSectionIndex, wireSection] of wireSections.entries()) {
    for (const [firstWireIndex, firstWire] of wireSection.wires.entries()) {
      for (
        let secondWireIndex = firstWireIndex + 1;
        secondWireIndex < wireSection.wires.length;
        secondWireIndex++
      ) {
        yield {
          wireSectionIndex,
          wireSection: {
            ...wireSection,
            wires: [firstWire, wireSection.wires[secondWireIndex]],
          },
        }
      }
    }
  }
}

/** Prioritize channel wires and use section length to break ties. */
function scoreWireSection({
  wireSection,
  channelPcbTraceIds,
}: {
  wireSection: Snapshot<WireSection>
  channelPcbTraceIds: ReadonlySet<PcbTrace["pcb_trace_id"]>
}): number {
  const channelWireCount = wireSection.wires.filter((wire) =>
    channelPcbTraceIds.has(wire.pcbTraceId),
  ).length
  return channelWireCount * 1e6 + wireSection.endMm - wireSection.startMm
}

/** One pair screen or coupled-group calculation per step. */
export class TransmissionLineRlgcSolver extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  readonly materials: DielectricMaterials
  private readonly input: TransmissionLineRlgcInput
  private readonly panelsPerEdge: number
  private readonly maskThicknessSource: MaskThicknessSource
  private readonly cache = new Map<CrossSectionKey, Snapshot<RlgcMatrices>>()
  private readonly solutions = new Map<CrossSectionKey, CrossSectionSolution>()
  private readonly pairCouplingsBySection = new Map<number, PairCoupling[]>()
  private readonly solvedWireSections: SolvedWireSection[] = []
  private readonly wirePairs: IterableIterator<IndexedWireSection>
  private coupledSections?: IterableIterator<IndexedWireSection>
  private output?: Produced<TransmissionLineRlgc>
  private screenedPairCount = 0
  private cacheHitCount = 0
  private solveMilliseconds = 0
  private currentWireSection?: Snapshot<WireSection>
  private currentCrossSection?: CrossSection

  /** Snapshot the board and options and validate the effective settings before stepping. */
  constructor(input: TransmissionLineRlgcInput) {
    super()
    this.input = snapshot(input)
    this.panelsPerEdge = resolvePanelsPerEdge(this.input.panelsPerEdge)
    const { materials, maskThicknessSource } = resolveMaterials({
      explicitMaterials: this.input.materials,
      stackupMaskThicknessMm: this.input.copperGeometry.maskThicknessMm,
    })
    this.materials = materials
    this.maskThicknessSource = maskThicknessSource
    this.wirePairs = enumerateWirePairs(
      this.input.copperGeometry.geometry.sections,
    )
  }

  /** Reuse a calculation only when all relative geometry and materials match exactly. */
  private solveSection(
    wireSection: Snapshot<WireSection>,
  ): CrossSectionSolution {
    const crossSection = buildCrossSection({
      geometry: this.input.copperGeometry.geometry,
      wireSection,
      materials: this.materials,
    })
    this.currentWireSection = wireSection
    this.currentCrossSection = crossSection
    const crossSectionKey = JSON.stringify(crossSection)
    const cachedMatrices = this.cache.get(crossSectionKey)
    if (cachedMatrices) {
      this.cacheHitCount += 1
      return { crossSectionKey, rlgcMatrices: cachedMatrices }
    }
    const startMilliseconds = performance.now()
    const rlgcMatrices = snapshot(
      calculateRlgc({
        crossSection,
        options: { panelsPerEdge: this.panelsPerEdge },
      }),
    )
    this.solveMilliseconds += performance.now() - startMilliseconds
    this.cache.set(crossSectionKey, rlgcMatrices)
    return { crossSectionKey, rlgcMatrices }
  }

  /** Record a pair decision once, using the matrices calculated in this step. */
  private screenPair({
    wireSectionIndex,
    wireSection,
  }: IndexedWireSection): void {
    const [firstWire, secondWire] = wireSection.wires
    const { rlgcMatrices } = this.solveSection(wireSection)
    const coupling = screenWirePair({
      wireSectionIndex,
      wireIndices: [firstWire.wireIndex, secondWire.wireIndex],
      rlgcMatrices,
    })
    const pairCouplings = this.pairCouplingsBySection.get(wireSectionIndex)
    if (pairCouplings) pairCouplings.push(coupling)
    else this.pairCouplingsBySection.set(wireSectionIndex, [coupling])
    this.screenedPairCount += 1
  }

  /** Partition each section by its completed pair decisions, in board order. */
  private *enumerateCoupledSections(): IterableIterator<IndexedWireSection> {
    for (const [
      wireSectionIndex,
      inputSection,
    ] of this.input.copperGeometry.geometry.sections.entries()) {
      const pairCouplings = this.pairCouplingsBySection.get(wireSectionIndex)
      if (!pairCouplings) {
        yield { wireSectionIndex, wireSection: inputSection }
        continue
      }
      for (const wireSection of groupCoupledWires({
        wireSection: inputSection,
        pairCouplings,
      }))
        yield { wireSectionIndex, wireSection }
    }
  }

  /** Advance one pair or one coupled section and record step timings. */
  override _step(): void {
    const startMilliseconds = performance.now()
    this.solveNext()
    this.stats = {
      uniqueSolveCount: this.cache.size,
      screenedPairCount: this.screenedPairCount,
      solvedSectionCount: this.solvedWireSections.length,
      cacheHitCount: this.cacheHitCount,
      solveMilliseconds: this.solveMilliseconds,
      stepMilliseconds: performance.now() - startMilliseconds,
    }
  }

  /** Screen all pairs before calculating the matrices of their connected groups. */
  private solveNext(): void {
    if (!this.coupledSections) {
      const pair = this.wirePairs.next()
      if (!pair.done) {
        this.screenPair(pair.value)
        return
      }
      this.coupledSections = this.enumerateCoupledSections()
    }
    const group = this.coupledSections.next()
    if (group.done) {
      this.finish()
      return
    }
    const { wireSectionIndex, wireSection } = group.value
    const solution = this.solveSection(wireSection)
    this.solutions.set(solution.crossSectionKey, solution)
    this.solvedWireSections.push({
      ...wireSection,
      wireSectionIndex,
      ...solution,
    })
  }

  /** Publish the solved groups and the geometry entries they reference. */
  private finish(): void {
    const warnings = [
      ...this.input.copperGeometry.geometry.warnings,
      PARALLEL_COUPLING_WARNING,
    ]
    const pairCouplings = Array.from(
      this.pairCouplingsBySection.values(),
    ).flat()
    const solvedSections = snapshot({
      solvedWireSections: this.solvedWireSections,
      crossSectionSolutions: [...this.solutions.values()],
      pairCouplings,
      warnings,
      materials: this.materials,
      maskThicknessSource: this.maskThicknessSource,
      panelsPerEdge: this.panelsPerEdge,
    })
    const scope = rootScope("rlgc").child(this.input.artifactPrefix)
    const artifact = scope.json("transmission-line-rlgc.json", {
      ...solvedSections,
      solvedWireSections: solvedSections.solvedWireSections.map(
        (wireSection) => ({
          wireSectionIndex: wireSection.wireSectionIndex,
          startMm: wireSection.startMm,
          endMm: wireSection.endMm,
          wireIndices: wireSection.wires.map((wire) => wire.wireIndex),
          references: wireSection.references,
          crossSectionKey: wireSection.crossSectionKey,
        }),
      ),
    })
    this.output = Object.freeze({
      value: solvedSections,
      artifacts: snapshot([artifact]),
    })
    this.solved = true
  }

  /** The completed immutable matrices and coupling decisions. */
  override getOutput(): Produced<TransmissionLineRlgc> {
    if (!this.output) throw new Error("Wire sections are not solved")
    return this.output
  }

  /** Replay options independent of solver progress. */
  override getConstructorParams(): ConstructorParameters<
    typeof TransmissionLineRlgcSolver
  > {
    return [this.input]
  }

  /** Draw the current section, or the completed section with the most channel wires. */
  override visualize(): GraphicsObject {
    const { geometry, circuitJson, copperScope } = this.input.copperGeometry
    const channelPcbTraceIds = new Set(copperScope.channelPcbTraceIds)
    let bestSection: SolvedWireSection | undefined
    if (this.solved) {
      bestSection = [...this.solvedWireSections].sort(
        (firstSection, secondSection) =>
          scoreWireSection({ wireSection: secondSection, channelPcbTraceIds }) -
          scoreWireSection({ wireSection: firstSection, channelPcbTraceIds }),
      )[0]
    }
    let wireSection = this.currentWireSection ?? geometry.sections[0]
    if (bestSection) wireSection = bestSection
    let crossSection = this.currentCrossSection
    if (wireSection && (bestSection || !crossSection)) {
      crossSection = buildCrossSection({
        geometry,
        wireSection,
        materials: this.materials,
      })
    }
    let rlgcMatrices = bestSection?.rlgcMatrices
    if (!rlgcMatrices && crossSection)
      rlgcMatrices = this.cache.get(JSON.stringify(crossSection))
    return drawTransmissionLineRlgc({
      geometry,
      circuitJson: cloneCircuitJson(circuitJson),
      scope: copperScope,
      materials: this.materials,
      solved: this.solvedWireSections,
      slice: wireSection,
      section: crossSection,
      line: rlgcMatrices,
      error: this.error || undefined,
    })
  }
}

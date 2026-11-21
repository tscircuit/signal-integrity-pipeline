import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  CircuitJson,
  CopperScope,
  RouteSlice,
  SectionGeometry,
} from "../board"
import { type Produced, rootScope, snapshot } from "../kernel"
import { solveCrossSection } from "./cross-section"
import type { CrossSection } from "./cross-section-types"
import { fieldsDrawing } from "./fields-visual"
import { type RouteCoupling, routeCoupling } from "./route-coupling"
import {
  type ExtractedRouteSlice,
  type ExtractedRoutes,
  type RouteCoefficients,
  type RouteMaterials,
  routeCrossSection,
  type SolvedRouteSection,
} from "./route-lines"

/** Standard edge resolution and lower bound accepted by the routed field stage. */
const DEFAULT_FIELD_PANELS = 12
/** Reject requests below the routed field stage’s minimum panel count. */
const MIN_FIELD_PANELS = 2

/** Keep the pair screen and local matrix solves within modest memory. */
const MAX_SCREEN_CONDUCTORS = 40

const PARALLEL_COUPLING_WARNING = [
  "Parallel coupling retains connected pairs until both abs(Cij)/sqrt(Cii*Cjj) and abs(Lij)/sqrt(Lii*Ljj)",
  "are below 0.005 (0.5%). Pair screening is not an aggregate waveform error bound.",
  "Geometry admission follows the recorded copper scope;",
  "fields beyond its cap and nonadjacent layers are unbounded omissions.",
  `Local solves are capped at ${MAX_SCREEN_CONDUCTORS} conductors and fail explicitly.`,
].join(" ")

/** Routed geometry, extraction options, and the artifact location. */
export interface RouteFieldsInput {
  geometry: SectionGeometry
  circuitJson?: CircuitJson
  scope?: CopperScope
  materials?: RouteMaterials
  maskThicknessMm?: number | null
  panels?: number
  artifactPrefix: string
}
/** Explicit unmeasured material assumptions; provenance accompanies every output. */
export const assumedRouteMaterials: RouteMaterials = {
  maskMm: 0.02,
  maskEr: 3.3,
  maskLoss: 0.025,
  substrateLoss: 0.02,
}

/** Provenance of the mask thickness recorded with the extraction. */
function maskThicknessSource(
  input: RouteFieldsInput,
): "explicit" | "preset" | "assumed" {
  if (input.materials) return "explicit"
  if (input.maskThicknessMm != null) return "preset"
  return "assumed"
}

/** Queue each conductor pair in slice order so cache population precedes coupling decisions. */
function addCouplingPairs({
  slices,
  pairs,
}: {
  slices: RouteSlice[]
  pairs: RouteSlice[]
}): void {
  for (const slice of slices) {
    const count = slice.wires.length
    if (count > MAX_SCREEN_CONDUCTORS) {
      throw new Error(
        `Coupling screen has ${count} conductors; exceeds modest-memory limit of ${MAX_SCREEN_CONDUCTORS}`,
      )
    }
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        pairs.push({ ...slice, wires: [slice.wires[i], slice.wires[j]] })
      }
    }
  }
}

/** Rank slices by selected conductors, then by length. */
function sliceWeight({
  slice,
  selected,
}: {
  slice: RouteSlice
  selected: ReadonlySet<string>
}): number {
  return (
    slice.wires.filter((wire) => selected.has(wire.trace)).length * 1e6 +
    slice.end -
    slice.start
  )
}

/** One pair screen or one unique multiconductor BEM solve per synchronous step. */
export class RouteFieldsSolver extends BaseSolver {
  private readonly cache = new Map<
    SolvedRouteSection["key"],
    RouteCoefficients
  >()
  private pairs?: RouteSlice[]
  private groups?: RouteSlice[]
  private readonly slices: ExtractedRouteSlice[] = []
  private readonly coupling: RouteCoupling[] = []
  private pairIndex = 0
  private groupIndex = 0
  private currentSlice?: RouteSlice
  private current?: CrossSection
  private output?: Produced<ExtractedRoutes>
  private solveMilliseconds = 0
  readonly materials: RouteMaterials
  /** Resolve material assumptions once; caches belong exclusively to this solver. */
  constructor(private readonly input: RouteFieldsInput) {
    super()
    this.materials = input.materials ?? {
      ...assumedRouteMaterials,
      maskMm: input.maskThicknessMm ?? assumedRouteMaterials.maskMm,
    }
    const panels = input.panels ?? DEFAULT_FIELD_PANELS
    if (!Number.isInteger(panels) || panels < MIN_FIELD_PANELS) {
      throw new Error(
        `Field panels must be an integer at least ${MIN_FIELD_PANELS}`,
      )
    }
  }
  /** Canonical relative geometry owns the cache identity, independent of source IDs and stimulus. */
  private solveSlice(slice: RouteSlice): SolvedRouteSection {
    const section = routeCrossSection({
      geometry: this.input.geometry,
      slice,
      materials: this.materials,
    })
    this.current = section
    this.currentSlice = slice
    const key = JSON.stringify(section)
    const cached = this.cache.get(key)
    if (cached) {
      this.stats.cacheHits = (this.stats.cacheHits ?? 0) + 1
      return { key, line: cached }
    }
    const start = performance.now()
    let line: RouteCoefficients
    try {
      line = snapshot(
        solveCrossSection({
          section,
          options: { panelsPerEdge: this.input.panels ?? DEFAULT_FIELD_PANELS },
        }),
      )
    } catch (error) {
      throw Object.assign(error as Error, {
        routeSection: section,
        wires: slice.wires,
        references: slice.references,
        solved: this.cache.size,
        solveMilliseconds: this.solveMilliseconds,
      })
    }
    this.solveMilliseconds += performance.now() - start
    this.cache.set(key, line)
    return { key, line }
  }
  /** Advance one work item and record the step timing. */
  override _step(): void {
    const start = performance.now()
    this.solveNext()
    this.stats = {
      ...this.stats,
      uniqueSolves: this.cache.size,
      pairs: this.pairIndex,
      sections: this.groupIndex,
      solveMilliseconds: this.solveMilliseconds,
      stepMilliseconds: performance.now() - start,
    }
  }
  /** Preserve the all-pairs-first ordering and routeCoupling's sole union predicate. */
  private solveNext(): void {
    if (!this.pairs) {
      this.pairs = []
      addCouplingPairs({
        slices: this.input.geometry.slices,
        pairs: this.pairs,
      })
    }
    if (this.pairIndex < this.pairs.length) {
      this.solveSlice(this.pairs[this.pairIndex++])
      return
    }
    this.groups ??= this.input.geometry.slices.flatMap((slice) =>
      routeCoupling({
        slice,
        solve: (pair) => this.cachedPair(pair),
        records: this.coupling,
      }),
    )
    if (this.groupIndex < this.groups.length) {
      const slice = this.groups[this.groupIndex++]
      this.slices.push({ ...slice, ...this.solveSlice(slice) })
    }
    if (this.groupIndex !== this.groups.length) return
    this.finish()
  }

  /** Retrieve the screen coefficient matrix prepared before grouping the routes. */
  private cachedPair(pair: RouteSlice): RouteCoefficients {
    const section = routeCrossSection({
      geometry: this.input.geometry,
      slice: pair,
      materials: this.materials,
    })
    const line = this.cache.get(JSON.stringify(section))
    if (!line) throw new Error("Pair screen was not solved")
    return line
  }

  /** Freeze the solved fields and write the geometry-to-coefficient map. */
  private finish(): void {
    const warnings = [
      ...this.input.geometry.warnings,
      PARALLEL_COUPLING_WARNING,
    ]
    const sections = [...this.cache].map(([key, line]) => ({ key, line }))
    const value = snapshot({
      slices: this.slices,
      sections,
      coupling: this.coupling,
      warnings,
      materials: this.materials,
    })
    const scope = rootScope("extraction").child(this.input.artifactPrefix)
    const artifact = scope.json("fields.json", {
      sections,
      slices: this.slices.map((slice) => ({
        start: slice.start,
        end: slice.end,
        wires: slice.wires.map((wire) => wire.id),
        references: slice.references,
        key: slice.key,
      })),
      coupling: this.coupling,
      warnings,
      materials: this.materials,
      maskThicknessSource: maskThicknessSource(this.input),
      panelsPerEdge: this.input.panels ?? DEFAULT_FIELD_PANELS,
    })
    this.output = { value, artifacts: [artifact] }
    this.solved = true
  }
  /** Only a completed extraction can be consumed by the network. */
  override getOutput(): Produced<ExtractedRoutes> {
    if (!this.output) throw new Error("Route fields are incomplete")
    return this.output
  }
  /** The cache and work queues never enter debugger downloads. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteFieldsSolver
  > {
    return [this.input]
  }

  /**
   * Solved copper coloured by Z0 with the slice on screen cut in amber; once finished, the slice with the most
   * selected conductors.
   */
  override visualize(): GraphicsObject {
    const { geometry, circuitJson, scope } = this.input
    const selected = new Set(
      scope?.selectedPcbTraceIds ?? geometry.wires.map((wire) => wire.trace),
    )
    let best: ExtractedRouteSlice | undefined
    if (this.solved)
      best = [...this.slices].sort(
        (a, b) =>
          sliceWeight({
            slice: b,
            selected,
          }) -
          sliceWeight({
            slice: a,
            selected,
          }),
      )[0]
    const slice = best ?? this.currentSlice ?? geometry.slices[0]
    let section = this.current
    if (slice && (best || !section))
      section = routeCrossSection({
        geometry,
        slice,
        materials: this.materials,
      })
    const line =
      best?.line ?? (section && this.cache.get(JSON.stringify(section)))
    let error: string | undefined
    if (this.failed) error = this.error ?? "Field solve failed"
    return fieldsDrawing({
      geometry,
      circuitJson,
      scope,
      materials: this.materials,
      solved: this.slices,
      slice,
      section,
      line,
      error,
    })
  }
}

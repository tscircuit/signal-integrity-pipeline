import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { type Produced, type Snapshot, snapshot } from "../kernel"

/** A solver that produces one channel simulation’s output and artifacts. */
type ItemSolver<I, O> = BaseSolver & {
  getOutput(): Produced<O>
  getConstructorParams(): ConstructorParameters<ItemClass<I, O>>
}
/** The constructor of a single-channel simulation solver. */
type ItemClass<I, O> = new (input: I) => ItemSolver<I, O>

/** A flat stage constructor with its domain solver already bound. */
type RoutedStageClass<I, O> = new (inputs: I[]) => RoutedStageSolver<I, O>

/** Ordered stage work and the algorithm that processes each item. */
interface RoutedStageInput<I, O> {
  inputs: I[]
  solverClass: ItemClass<I, O>
}

/** Ordered inputs used to reconstruct a stage whose solver class is bound. */
type RoutedStageConstructorParams<I> = [I[]]

/** A completed, deeply readonly array of domain outputs and their artifacts. */
export type RoutedStageOutput<O> = Produced<readonly Snapshot<O>[]>

/** One flat stage drains the domain algorithm one item at a time across all admitted channel simulations. */
export class RoutedStageSolver<I, O> extends BaseSolver {
  override MAX_ITERATIONS = Infinity
  private current?: ItemSolver<I, O>
  private readonly outputs: Produced<O>[] = []
  private output?: RoutedStageOutput<O>
  private readonly completedStats: Record<string, number> = {}
  private readonly inputs: I[]
  private readonly solverClass: ItemClass<I, O>
  /** The stage definition owns the algorithm; downloads contain only its ordered input values. */
  constructor({ inputs, solverClass }: RoutedStageInput<I, O>) {
    super()
    this.inputs = inputs
    this.solverClass = solverClass
    if (inputs.length) this.current = new solverClass(inputs[0])
  }
  /** Use the domain name in debugger breadcrumbs, without creating nested pipeline rows. */
  override getSolverName(): string {
    return this.solverClass.name
  }
  /** Only the transient algorithm requires asynchronous stepping. */
  override assertCanStepSynchronously(): void {
    if (this.inputs.length === 0) return
    if (
      this.solverClass.prototype._stepAsync !== BaseSolver.prototype._stepAsync
    ) {
      super.assertCanStepSynchronously()
    }
  }
  /** Start the next channel simulation only after the previous channel simulation has completed successfully. */
  private prepare(): ItemSolver<I, O> | undefined {
    if (this.outputs.length === this.inputs.length) {
      this.output = {
        value: snapshot(this.outputs.map((output) => output.value)),
        artifacts: this.outputs.flatMap((output) => output.artifacts),
      }
      this.stats = {
        ...this.stats,
        channelSimulations: this.inputs.length,
        completedChannelSimulations: this.outputs.length,
      }
      this.progress = 1
      this.solved = true
      return
    }
    this.current ??= new this.solverClass(this.inputs[this.outputs.length])
    return this.current
  }
  /** Include the current channel simulation in stage stats even when its step throws. */
  private recordStats(): void {
    const current = this.current!
    const stats = { ...current.stats }
    for (const [name, stat] of Object.entries(current.stats)) {
      if (typeof stat !== "number") continue
      const completed = this.completedStats[name] ?? 0
      if (name.startsWith("maximum")) {
        stats[name] = Math.max(completed, stat)
        continue
      }
      stats[name] = completed + stat
    }
    this.stats = {
      ...stats,
      channelSimulations: this.inputs.length,
      completedChannelSimulations: this.outputs.length + Number(current.solved),
    }
    if (current.solved) Object.assign(this.completedStats, stats)
  }
  /** Record only completed domain outputs; failures never expose a partial stage result. */
  private finish(): void {
    const current = this.current!
    if (current.failed)
      throw new Error(current.error ?? `${this.getSolverName()} failed`)
    if (!current.solved) {
      this.progress =
        (this.outputs.length + current.progress) / this.inputs.length
      return
    }
    this.outputs.push(current.getOutput())
    if (this.outputs.length === this.inputs.length) {
      this.prepare()
      return
    }
    this.progress = this.outputs.length / this.inputs.length
  }
  /** Preserve synchronous compile-only stepping through all five non-native stages. */
  override _step(): void {
    if (this.current?.solved) this.current = undefined
    const current = this.prepare()
    if (!current) return
    try {
      current.step()
    } finally {
      this.recordStats()
    }
    this.finish()
  }
  /** Await one item, so ngspice calls remain strictly sequential across channel simulations. */
  override async _stepAsync(): Promise<void> {
    if (this.current?.solved) this.current = undefined
    const current = this.prepare()
    if (!current) return
    try {
      await current.stepAsync()
    } finally {
      this.recordStats()
    }
    this.finish()
  }
  /** The immutable stage boundary is an array in admission order. */
  override getOutput(): RoutedStageOutput<O> {
    if (!this.output) throw new Error(`${this.getSolverName()} is incomplete`)
    return this.output
  }
  /** Retain each original domain input for constructor downloads and focused diagnostics. */
  override getConstructorParams(): RoutedStageConstructorParams<I> {
    return [this.inputs]
  }
  /** Retain the last channel simulation's drawing when its stage completes, or a blank drawing when no channel simulations were admitted. */
  override visualize(): GraphicsObject {
    return this.current?.visualize() ?? { coordinateSystem: "cartesian" }
  }
}

/** Bind a domain algorithm once in the static stage tuple, with no runtime stage creation. */
export function routedStage<I, O>(
  solverClass: ItemClass<I, O>,
): RoutedStageClass<I, O> {
  return class extends RoutedStageSolver<I, O> {
    /** One immutable input per admitted channel simulation; the stage owns its ordered work queue. */
    constructor(inputs: I[]) {
      super({ inputs, solverClass })
    }
  }
}

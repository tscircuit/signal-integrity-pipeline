import { BaseSolver } from "@tscircuit/solver-utils"
import { type Produced, rootScope, sha256, snapshot } from "../kernel"
import { type SpiceProbeRow, spiceProbeRows } from "../observation"
import { invoke, type SolverContext, type SolverRequest } from "../solver"
import { fail } from "./diagnostics"
import type { RoutedCapture, RoutedDeck } from "./routed-types"

/** The compiled deck and injected engine capabilities for a routed transient. */
export interface RouteTransientInput {
  compiled: RoutedDeck
  artifactPrefix: string
  context: SolverContext
}

/** A solver request with the routed transient's single raw waveform output. */
type RoutedSolverRequest = SolverRequest & { outputFiles: ["waveform.raw"] }

/** Native batch writes complete ASCII raw vectors for the declarative transient deck. */
export function routedRequest(
  compiled: Pick<RoutedDeck, "deck">,
): RoutedSolverRequest {
  return {
    solver: "ngspice",
    files: { "simulation.cir": compiled.deck },
    args: ["-n", "-b", "-r", "waveform.raw", "simulation.cir"],
    outputFiles: ["waveform.raw"],
  }
}

/** One async step invokes ngspice once and admits only complete real probe waveforms. */
export class RouteTransientSolver extends BaseSolver {
  private output?: Produced<RoutedCapture>
  /** Execution is an injected capability, separate from the immutable deck input. */
  constructor(private readonly input: RouteTransientInput) {
    super()
  }
  /** Await the engine, then validate diagnostics and full coverage before publishing samples. */
  override async _stepAsync(): Promise<void> {
    const { compiled } = this.input
    const started = performance.now()
    this.stats = { invocations: 1, samples: 0, probes: 0 }
    this.input.context.progress(
      `Simulate ${compiled.name} (${compiled.probes.length} probes)`,
    )
    const scope = rootScope("simulation").child(this.input.artifactPrefix)
    const execution = await invoke({
      context: this.input.context,
      scope: scope.child("solver").handTo("solver"),
      request: routedRequest(compiled),
    })
    const run = execution.value
    const logs = `${run.stdout}\n${run.stderr}`
    const diagnostic = logs.split("\n").find(hasSolverDiagnostic)
    if (diagnostic)
      fail("native_solver", `${compiled.name}: ${diagnostic.trim()}`, {
        artifacts: run.logPaths,
      })
    const raw = run.outputs["waveform.raw"]
    const rows = spiceProbeRows({ text: raw, probes: compiled.probes })
    validateCoverage({ compiled, rows })
    const capture = completedCapture({ compiled, rows })
    const artifact = scope.json("capture.json", {
      ...capture,
      waveformSha256: sha256(raw),
    })
    this.output = {
      value: capture,
      artifacts: [...execution.artifacts, artifact],
    }
    this.stats = {
      invocations: 1,
      samples: rows.length,
      probes: capture.probes.length,
      elapsedMs: performance.now() - started,
    }
    this.solved = true
  }
  /** Complete engine samples remain candidate evidence, without convergence qualification. */
  override getOutput(): Produced<RoutedCapture> {
    if (!this.output) throw new Error("Route transient is incomplete")
    return this.output
  }
  /** The runtime capability must be supplied again when constructing a new solver. */
  override getConstructorParams(): ConstructorParameters<
    typeof RouteTransientSolver
  > {
    return [this.input]
  }
}

/** Allow a relative tolerance for rounded ngspice timestamps at the deck boundaries. */
const TRANSIENT_TIME_TOLERANCE = 1e-8

/** Require samples covering the declared transient either side of timestamp rounding. */
function validateCoverage({
  compiled,
  rows,
}: {
  compiled: RoutedDeck
  rows: SpiceProbeRow[]
}): void {
  const toleranceSeconds = compiled.durationSeconds * TRANSIENT_TIME_TOLERANCE
  const firstTimeSeconds = rows[0][0]
  if (
    firstTimeSeconds < 0 ||
    firstTimeSeconds > Math.max(compiled.stepSeconds, toleranceSeconds)
  ) {
    fail(
      "simulation_start",
      `${compiled.name}: solver output omits the beginning of the transient`,
    )
  }
  const lastTimeSeconds = rows[rows.length - 1][0]
  if (Math.abs(lastTimeSeconds - compiled.durationSeconds) > toleranceSeconds) {
    fail(
      "simulation_duration",
      `${compiled.name}: solver did not complete the declared duration`,
    )
  }
}

/** Capture the adaptive timestamps and voltage column corresponding to each declared probe. */
function completedCapture({
  compiled,
  rows,
}: {
  compiled: RoutedDeck
  rows: SpiceProbeRow[]
}): RoutedCapture {
  return snapshot<RoutedCapture>({
    kind: "completed",
    qualification: "candidate-unqualified",
    timestampsSeconds: rows.map((row) => row[0]),
    probes: compiled.probes.map((probe, i) => ({
      name: probe.name,
      sourcePortId: probe.signalSourceId,
      voltageLevels: rows.map((row) => row[i + 1]),
    })),
  })
}

const solverDiagnostics = ["error", "fatal", "aborted", "timestep too small"]

/** Detect a fatal diagnostic at ASCII word boundaries in ngspice's output. */
function hasSolverDiagnostic(line: string): boolean {
  for (let start = 0; start < line.length; start++) {
    if (isWordCharacter(line[start - 1])) continue
    for (const diagnostic of solverDiagnostics) {
      const end = start + diagnostic.length
      if (
        line.slice(start, end).toLowerCase() === diagnostic &&
        !isWordCharacter(line[end])
      )
        return true
    }
  }
  return false
}

/** Recognize the letters, digits and underscore used in diagnostic word boundaries. */
function isWordCharacter(character?: string): boolean {
  if (character === undefined) return false
  return (
    character === "_" ||
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9")
  )
}

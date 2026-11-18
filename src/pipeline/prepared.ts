import { ArtifactLedger } from '../kernel'
import type { SolverContext } from '../solver'
import type { PreparedOptions, PreparedResult } from './result'
import { PRE_VALIDATION, type AnyStage, type Phase, type PipelineState, type PureContext } from './state'
import { STAGES } from './stages'

/**
 * Fold over STAGES in order. Pre-validation stages get a pure context.
 * Later stages receive the solver capability and run experiments sequentially.
 */
export async function runPrepared(options: PreparedOptions): Promise<PreparedResult> {
  const { runSolver, ...pure } = options
  const progress = pure.onProgress ?? (() => {})
  const pureContext: PureContext = { progress }
  const solverContext: SolverContext = { runSolver, progress }
  let state: PipelineState = { phase: 'input', options: pure }
  let ledger = ArtifactLedger.empty()
  for (const stage of STAGES as readonly AnyStage[]) {
    if (state.phase !== stage.from) throw new Error(`pipeline: stage ${stage.name} expects phase ${stage.from}, got ${state.phase}`)
    let context: PureContext = solverContext
    if ((PRE_VALIDATION as readonly Phase[]).includes(stage.from)) context = pureContext
    const next: { state: PipelineState; artifacts: Parameters<ArtifactLedger['add']>[0] } = await stage.run(state, context)
    ledger = ledger.add(next.artifacts)
    state = next.state
  }
  if (state.phase !== 'sealed') throw new Error(`pipeline: ended in phase ${state.phase}`)
  return { ...state.result, files: ledger.seal() }
}

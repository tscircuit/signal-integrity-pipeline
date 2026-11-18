import { validateCircuitRecords } from '../board'
import { jsonBody, sha256 } from '../kernel'
import type { RunSolver, Solver, SolverResult } from '../solver'
import type { PipelineBlockResult, PipelineOptions, PipelineResult, PreparedResult } from './result'
import { prepareBlocks, type PreparedBlock } from './signals'
import { runPrepared } from './prepared'
import { signalResults } from './results'
import { signalResultFiles } from './result-files'
import { fail } from './diagnostics'

type SolverRequestHash = string

interface NativeRunLog {
  extractionRuns: Map<SolverRequestHash, { block: string; result: SolverResult }>
  executions: { block: string; solver: Solver; request_sha256: SolverRequestHash; reused_from_block?: string }[]
}

/** Record every request and reuse matching extraction results, isolated from caller mutation. */
function recordedSolver({ options, block, log }: {
  options: PipelineOptions
  block: PreparedBlock['block']
  log: NativeRunLog
}): RunSolver {
  return async request => {
    const key = sha256(JSON.stringify(request))
    let previous: ReturnType<NativeRunLog['extractionRuns']['get']>
    if (request.solver !== 'ngspice') previous = log.extractionRuns.get(key)
    log.executions.push({ block: block.simulation_pcb_transient_channel_simulation_id, solver: request.solver, request_sha256: key, reused_from_block: previous?.block })
    if (previous) return structuredClone(previous.result)
    const result = await options.runSolver(request)
    if (request.solver !== 'ngspice') log.extractionRuns.set(key, { block: block.simulation_pcb_transient_channel_simulation_id, result: structuredClone(result) })
    return result
  }
}

/** Retry native extraction convergence failures, keeping the settings used for each attempt. */
async function runPreparedBlock({ current, options, log }: {
  current: PreparedBlock
  options: PipelineOptions
  log: NativeRunLog
}): Promise<{ result: PreparedResult; results: PipelineBlockResult['results']; refinements: unknown[] }> {
  const refinements: unknown[] = []
  const runSolver = recordedSolver({ options, block: current.block, log })
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await runPrepared({ ...options, circuitJson: current.circuit, controls: current.controls, modeling: current.settings, runSolver })
      return { result, results: signalResults(current, result), refinements }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (!['mesh_convergence', 'ground_mesh', 'cap_convergence'].includes(code ?? '') || attempt >= 4) throw error
      refinements.push({ attempt, code, message: (error as Error).message, settings: structuredClone(current.settings.extraction) })
      options.onProgress?.(`Refining ${current.block.name ?? current.block.simulation_pcb_transient_channel_simulation_id}: ${code}`)
      const settings = current.settings.extraction
      settings.filaments = settings.refinementFilaments
      settings.refinementFilaments += 4
      settings.groundMeshMm! /= 2
      settings.maxPanelLengthMm /= 2
    }
  }
  throw new Error('Automatic native refinement failed to converge')
}

/** Run every Circuit JSON signal-integrity block independently with native solver IO. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  if ('modeling' in options) fail('signal_integrity_input', 'modeling has been removed; describe the test with <simulation.pcbtransientchannelsimulation> and <simulation.pcbdriverreceiverchannel>')
  validateCircuitRecords(options.circuitJson)
  const prepared = prepareBlocks({ circuitJson: options.circuitJson, sources: options.ibisSources })
  const blocks: PipelineBlockResult[] = []
  const files: Record<string, string> = {}
  const log: NativeRunLog = { extractionRuns: new Map(), executions: [] }
  for (const current of prepared) {
    const { result, results, refinements } = await runPreparedBlock({ current, options, log })
    const id = current.block.simulation_pcb_transient_channel_simulation_id
    const prefix = `blocks/${id}`
    for (const [path, body] of Object.entries(result.files)) files[`${prefix}/${path}`] = body
    const experiments = result.experiments.map(run => ({ ...run, directory: `${prefix}/${run.directory}`, assemblyFile: `${prefix}/${run.assemblyFile}` }))
    files[`${prefix}/automatic-refinements.json`] = jsonBody(refinements)
    blocks.push({ simulation_pcb_transient_channel_simulation_id: id, name: current.block.name ?? id, duration_ms: current.block.duration_ms ?? current.duration * 1000, geometry: result.geometry, matrices: result.matrices, experiments,
      numericalSettings: current.settings, results, limitations: result.limitations })
  }
  const resultTypes = new Set(['simulation_signal_waveform_result', 'simulation_pcb_transient_channel_result'])
  const results = [...options.circuitJson.filter(record => !resultTypes.has(record.type)), ...blocks.flatMap(block => block.results)]
  Object.assign(files, signalResultFiles(results))
  files['native-execution.json'] = jsonBody(log.executions)
  return { circuitJson: options.circuitJson, simulationResultCircuitJson: results, blocks, geometry: blocks[0]?.geometry, matrices: blocks[0]?.matrices ?? [],
    experiments: blocks.flatMap(block => block.experiments), limitations: [...new Set(blocks.flatMap(block => block.limitations))], files }
}

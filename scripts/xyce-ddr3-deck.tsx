// Compile (never simulate) the routed DDR3_ADDR_CMD deck of the private board for the Xyce cross-check.
// Usage: SI_DDR3_BOARD=<circuit.json> IBIS_MODEL_DIR=<dir> tsx scripts/xyce-ddr3-deck.tsx <outdir> [--nets A3,A4,A5] [--duration 8e-9]
// Writes simulation.cir and evidence.json: both contain private board and vendor data, so <outdir> must stay out of git.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RoutedPipelineSolver } from '../src/pipeline'
import type { CircuitJson } from '../src/board'
import { withDdr3Signals } from '../examples/routed/ddr3-signals'

/** CLI value after `--name`. */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const out = resolve(process.argv[2] ?? '')
if (!process.argv[2] || !process.env.SI_DDR3_BOARD || !process.env.IBIS_MODEL_DIR) throw new Error('Usage: SI_DDR3_BOARD=... IBIS_MODEL_DIR=... tsx scripts/xyce-ddr3-deck.tsx <outdir> [--nets A3,A4,A5] [--duration 8e-9]')
const ibisSources = Object.fromEntries(await Promise.all(['sprm552c.ibs', 'W631GG6MB-12.ibs'].map(async file => [`models/${file}`, await readFile(join(process.env.IBIS_MODEL_DIR!, file), 'utf8')])))
const physical = JSON.parse(await readFile(process.env.SI_DDR3_BOARD, 'utf8')) as CircuitJson
const circuitJson = await withDdr3Signals(physical, ibisSources, { block: 'DDR3_ADDR_CMD', nets: argument('--nets')?.split(','), durationSeconds: Number(argument('--duration') ?? 8e-9) })
const root = new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, {
  progress: console.log,
  runSolver: async () => {
    throw new Error('compile only')
  },
})
while (!root.getSolver('RouteNetworkSolver')?.solved) await root.stepAsync()
const compiled = root.stageOutput('RouteNetworkSolver').value[0]
await mkdir(out, { recursive: true })
await writeFile(join(out, 'simulation.cir'), compiled.deck)
await writeFile(join(out, 'evidence.json'), JSON.stringify(compiled.evidence))
console.log(JSON.stringify({ cells: compiled.evidence.cells, deckBytes: compiled.deck.length, probes: compiled.probes.map(probe => probe.name) }))

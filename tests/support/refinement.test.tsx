import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Circuit } from '@tscircuit/core'
import { createNativeSolver } from '../../src/adapters'
import { RoutedPipelineSolver, type RoutedProblem } from '../../src/pipeline'
import { formatSpiceVectors } from '../../src/observation'
import type { CircuitJson } from '../../src/board'
import type { SolverContext } from '../../src/solver'
import { RefinementBoard, refinementIbis } from './refinement-board'
import { compareRefinement, edgeMetrics, type RefinementCapture } from './refinement'
import { ngspiceAvailable } from './golden-checks'

/** The committed three-trace TSX board with its original synthetic model. */
async function refinementProblem(): Promise<RoutedProblem> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(refinementIbis) } })
  circuit.add(<RefinementBoard />)
  await circuit.renderUntilSettled()
  return { circuitJson: circuit.getCircuitJson() as CircuitJson, ibisSources: { 'models/fast15.ibs': refinementIbis }, scopeDistanceMm: 1 }
}

/** Synthetic engine IO: it only lets the compile stages finish; these curves are not evidence. */
const synthetic: SolverContext = { progress: (): void => undefined, runSolver: async request => {
  const deck = request.files['simulation.cir']
  const names = [...new Set([...(/^\.save (.+)$/m.exec(deck)![1]).matchAll(/v\(([^)]+)\)/g)].map(match => match[1]))]
  return { stdout: '', stderr: '', files: { 'waveform.raw': formatSpiceVectors([{ name: 'time', type: 'time', values: [0, 5e-9] }, ...names.map(name => ({ name: `v(${name})`, type: 'voltage', values: [0, 0] }))]) } }
} }

/** Run every stage and return the deck, the field panel count and the capture. */
async function solve(problem: RoutedProblem, context: SolverContext): Promise<{ deck: string; cells: number; panels: number; capture: RefinementCapture }> {
  const root = new RoutedPipelineSolver(problem, context)
  await root.solveAsync()
  const block = root.getOutput().blocks[0]
  const fields = root.stageOutput('RouteFieldsSolver').artifacts.find(artifact => artifact.path.endsWith('fields.json'))!
  return { deck: block.compiled.deck, cells: Number(block.compiled.evidence.cells), panels: JSON.parse(fields.body).panelsPerEdge, capture: block.capture }
}

test('edge metrics count each full swing once, at its last 50% crossing', () => {
  const times = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  // Rises through 0.75 at t = 1.5, rings back to 0.7 and up again (one edge, crossing at 3.5), then falls at 6.5.
  const { overshoot, undershoot, crossings } = edgeMetrics(times, [0, .5, 1, .7, .8, 1.6, 1.6, -.1, 0], 1.5)
  assert.deepEqual(crossings.map(time => Number(time.toFixed(9))), [3.5, 6.5])
  assert.ok(Math.abs(overshoot - .1) < 1e-12 && Math.abs(undershoot - .1) < 1e-12)
})

test('refinement overrides change only their own knob in the compiled deck', async () => {
  const problem = await refinementProblem()
  const base = await solve(problem, synthetic)
  const step = Number(/^\.tran (\S+)/m.exec(base.deck)![1])
  const ladder = await solve({ ...problem, refinement: 2 }, synthetic)
  const timestep = await solve({ ...problem, stepSeconds: step / 2 }, synthetic)
  const panels = await solve({ ...problem, panels: 18 }, synthetic)
  assert.equal(base.panels, 12)
  assert.ok(ladder.cells >= 2 * base.cells - 3, `${ladder.cells} vs ${base.cells} cells`)
  assert.equal(Number(/^\.tran (\S+)/m.exec(timestep.deck)![1]), step / 2)
  assert.equal(timestep.cells, base.cells)
  assert.equal(panels.panels, 18)
  assert.notEqual(panels.deck, base.deck)
})

const native = (process.env.SI_NATIVE_TESTS !== '1' || !ngspiceAvailable()) && 'Set SI_NATIVE_TESTS=1 with ngspice on PATH for bounded sequential native checks'

test('three-trace TSX receivers converge under ladder, timestep and panel refinement', { skip: native }, async () => {
  const problem = await refinementProblem()
  const context: SolverContext = { progress: (): void => undefined, runSolver: createNativeSolver({ timeoutMs: 600_000 }) }
  const base = await solve(problem, context)
  const step = Number(/^\.tran (\S+)/m.exec(base.deck)![1])
  assert.deepEqual([...new Set(base.capture.probes.map(probe => probe.name.split('_')[0]))], ['L0', 'L1', 'L2'])
  for (const [name, refined] of [['ladder', { refinement: 2 }], ['timestep', { stepSeconds: step / 2 }], ['panels', { panels: 18 }]] as const) {
    const result = compareRefinement(base.capture, (await solve({ ...problem, ...refined }, context)).capture, 1.5)
    console.log(name, JSON.stringify({ crossingPs: result.crossing.seconds * 1e12, overshootMv: result.overshoot.volts * 1e3, undershootMv: result.undershoot.volts * 1e3, waveformMv: result.waveform.volts * 1e3, edgeCountMismatches: result.edgeCountMismatches }))
    assert.ok(result.pass, `${name}: ${JSON.stringify(result)}`)
  }
})

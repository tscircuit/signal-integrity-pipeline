import test from 'node:test'
import assert from 'node:assert/strict'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { compareWaveforms, crossings, ngspiceCapture, runCrossCheck, xyceColumns, type Waveforms } from '../../scripts/xyce-cross-check'
import { ngspiceAvailable } from '../support/golden-checks'

/** A 1 V step through `t0` with a 100 ps linear edge, sampled every picosecond for 1 ns, plus `offset` volts. */
function edge(t0: number, offset: number = 0): Waveforms {
  const times = Array.from({ length: 1001 }, (_, i) => i * 1e-12)
  return { times, nodes: new Map([['v(n1)', times.map(time => Math.min(1, Math.max(0, (time - t0) / 100e-12 + .5)) + offset)]]) }
}

test('crossings count one per excursion and ignore ripple inside the hysteresis band', () => {
  const times = [0, 1, 2, 3, 4, 5, 6]
  assert.deepEqual(crossings(times, [0, .49, .51, .49, .51, 1, 0], .5, .1), [3.5, 5.5], 'the last level crossing before the band is left')
  assert.deepEqual(crossings(times, [0, 1, 0, 1, 1, 1, 1], .5, .1), [.5, 1.5, 2.5])
})

test('edges within 5 ps and 10 mV agree; a later edge or an offset does not', () => {
  const reference = edge(500e-12)
  const near = compareWaveforms(reference, edge(500.8e-12))
  assert.equal(near.pass, true)
  assert.ok(Math.abs(near.nodes[0].maximumCrossingDifferenceS! - .8e-12) < 1e-15 && Math.abs(near.nodes[0].maximumDifferenceV - .008) < 1e-9)
  // 3 ps at 10 mV/ps is 30 mV: on a 100 ps edge the voltage tolerance binds before the timing one.
  const later = compareWaveforms(reference, edge(503e-12)).nodes[0]
  assert.ok(Math.abs(later.maximumCrossingDifferenceS! - 3e-12) < 1e-15 && Math.abs(later.maximumDifferenceV - .03) < 1e-9 && !later.pass)
  assert.ok(compareWaveforms(reference, edge(506e-12)).nodes[0].maximumCrossingDifferenceS! > 5e-12)
  assert.equal(compareWaveforms(reference, edge(500e-12, .011)).pass, false)
  assert.equal(compareWaveforms(reference, { ...edge(500e-12), times: edge(500e-12).times.map(time => time / 2) }).pass, false, 'an incomplete run fails')
})

test('Xyce CSV columns and pipeline captures key by deck node', () => {
  const xyce = xyceColumns('TIME,V(N1),V(ROUTE4)\n0,0.1,0.2\n1e-12,0.3,0.4\n')
  assert.deepEqual(xyce.times, [0, 1e-12])
  assert.deepEqual(xyce.nodes.get('v(route4)'), [.2, .4])
  const capture = ngspiceCapture({ timestampsSeconds: [0, 1], probes: [{ name: 'A', voltageLevels: [1, 2] }, { name: 'B_P', voltageLevels: [3, 4] }] },
    [{ name: 'A', signalNode: 'N7', referenceNode: '0' }, { name: 'B', signalNode: 'n8', referenceNode: 'n9' }, { name: 'B_P', signalNode: 'n8', referenceNode: '0' }])
  assert.deepEqual([...capture.nodes], [['v(n7)', [1, 2]], ['v(n8)', [3, 4]]])
})

/** XYCE, or `Xyce` on PATH. */
function xyceAvailable(): boolean {
  return [process.env.XYCE, ...(process.env.PATH ?? '').split(delimiter).map(directory => join(directory, 'Xyce'))].some(path => {
    try {
      accessSync(path ?? '', constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

const native = process.env.SI_NATIVE_TESTS !== '1' && 'Set SI_NATIVE_TESTS=1 for bounded sequential native checks'
// Measured 2026-11-16: 11.4 mV (vcvs) and 12.5 mV (native K) against the 10 mV tolerance. Both engines are ~15 mV
// from a converged run at the deck's 15.8 ps step ceiling (docs/xyce-cross-check.md), so this stays todo, not loosened.
const finding = 'time-step error at the deck step ceiling: 11.4 / 12.5 mV vs 10 mV'
for (const mutual of ['vcvs', 'native'] as const) test(`ngspice and Xyce agree on the committed routed TSX deck (${mutual} mutual inductance)`, { skip: native, todo: finding }, async context => {
  if (!ngspiceAvailable() || !xyceAvailable()) return context.skip('ngspice and Xyce (XYCE or PATH) are both required')
  const out = mkdtempSync(join(tmpdir(), 'xyce-cross-check-'))
  try {
    const report = await runCrossCheck(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'two-trace.cir'), 'utf8'), out, mutual)
    context.diagnostic(JSON.stringify({ ...report, nodes: report.nodes.map(node => ({ node: node.node, swingV: node.swingV, mV: node.maximumDifferenceV * 1e3, ps: (node.maximumCrossingDifferenceS ?? 0) * 1e12, crossings: node.crossings })) }))
    assert.equal(report.nodes.length, 3)
    assert.ok(report.nodes.some(node => node.crossings > 0), 'the driven net switches')
    assert.equal(report.pass, true, JSON.stringify(report.nodes.filter(node => !node.pass)))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

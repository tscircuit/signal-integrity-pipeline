import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spiceValue, xyceDeck } from '../../scripts/xyce-deck'
import { xyceTwoTraceDeck } from '../support/xyce-two-trace'

// The routed deck of the real TwoTraceBoard TSX with an original synthetic IBIS buffer: no vendor data.
const fixture = join(import.meta.dirname, '..', 'fixtures', 'two-trace.cir')
const deck = readFileSync(fixture, 'utf8')

test('the committed deck is the current routed deck format', async () => {
  const current = await xyceTwoTraceDeck()
  if (process.env.UPDATE_XYCE_DECKS === '1') writeFileSync(fixture, current)
  assert.equal(current, deck, 'routed deck format changed: rerun with UPDATE_XYCE_DECKS=1 and repeat the Xyce cross-check')
})

test('options, probes and B-source tables translate to their Xyce forms', () => {
  const xyce = xyceDeck(deck, { mutual: 'vcvs', printFile: 'waveform.csv' })
  const lines = xyce.split('\n')
  assert.deepEqual(lines.filter(line => line.startsWith('.options')), [
    '.options timeint method=gear reltol=1e-4 abstol=1e-6 maxord=2',
    '.options nonlin reltol=1e-4 abstol=1e-6 rhstol=1e-9 deltaxtol=1',
    '.options nonlin-tran reltol=1e-4 abstol=1e-6 rhstol=1e-9 deltaxtol=1',
    '.options linsol type=klu',
  ])
  const saved = /^\.save (.+)$/m.exec(deck)![1].split(' ').filter(vector => vector.startsWith('v('))
  assert.equal(lines.filter(line => line.startsWith('.print')).join(), `.print tran format=csv precision=12 file=waveform.csv ${saved.join(' ')}`)
  assert.ok(!/^\.save/m.test(xyce) && !/pwl\(/i.test(xyce.replace(/PWL\(0 /g, '')), 'no .save and no B-source pwl remain')
  assert.equal(lines.filter(line => /^B.*table\(min\(max\(/.test(line)).length, deck.split('\n').filter(line => /^B/.test(line)).length)
  /** Lines outside the translated constructs. */
  const rest = (text: string, translated: RegExp): string[] => text.split('\n').filter(line => !translated.test(line))
  assert.deepEqual(rest(xyce, /^(?:\.options|\.print|[lLB]|exm_)/), rest(deck, /^(?:\.options|\.save|[LKB])/), 'every other line passes through unchanged')
})

/** Rebuild the inductance matrix a translated deck realizes: V_i = L_i dI_i + sum_j gain_ij V(L_j self). */
function realized(xyce: string): Map<string, Map<string, number>> {
  const self = new Map<string, number>()
  const owner = new Map<string, string>()
  const matrix = new Map<string, Map<string, number>>()
  for (const line of xyce.split('\n')) {
    const [name, from, to, value] = line.split(' ')
    if (/^l/.test(name)) {
      self.set(name, Number(value))
      owner.set(`${from}|${to}`, name)
      matrix.set(name, new Map([[name, Number(value)]]))
    }
  }
  for (const line of xyce.split('\n').filter(line => line.startsWith('exm_'))) {
    const [name, , , from, to, gain] = line.split(' ')
    const inductor = /^exm_(.+)_\d+$/.exec(name)![1]
    const other = owner.get(`${from}|${to}`)!
    matrix.get(inductor)!.set(other, Number(gain) * self.get(other)!)
  }
  return matrix
}

test('the VCVS chains realize exactly the coupled inductance matrix of the K lines', () => {
  const triangle = ['* K triangle', 'L1 a b 1n', 'L2 c d 2n', 'L3 e f 4n', 'K12 L1 L2 0.5', 'K23 L2 L3 0.25', 'K13 L1 L3 -0.125', 'V1 a 0 1', '.save v(b)', '.tran 1p 1n 0 1p', '.end'].join('\n')
  for (const source of [deck, triangle]) {
    const expected = new Map<string, Map<string, number>>()
    const values = new Map(source.split('\n').filter(line => /^L/.test(line)).map(line => [line.split(' ')[0].toLowerCase(), spiceValue(line.split(' ')[3])]))
    for (const line of source.split('\n').filter(line => /^K/.test(line))) {
      const [, a, b, k] = line.toLowerCase().split(' ')
      for (const name of [a, b]) if (!expected.has(name)) expected.set(name, new Map([[name, values.get(name)!]]))
      const mutual = Number(k) * Math.sqrt(values.get(a)! * values.get(b)!)
      expected.get(a)!.set(b, mutual)
      expected.get(b)!.set(a, mutual)
    }
    const actual = realized(xyceDeck(source, { mutual: 'vcvs', printFile: 'w.csv' }))
    assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort())
    for (const [i, row] of expected) for (const [j, value] of row) assert.ok(Math.abs(actual.get(i)!.get(j)! / value - 1) <= 1e-12, `M(${i},${j})`)
    assert.ok([...actual.values()].every(row => row.size === expected.get([...row.keys()][0])!.size))
  }
  assert.match(xyceDeck(deck, { mutual: 'native', printFile: 'w.csv' }), /^KARCL0_3 LARCL0 LARCL3 0\.501274545939$/m)
})

test('constructs whose Xyce meaning would differ are rejected, not passed through', () => {
  const base = ['* t', '.options klu reltol=1e-4', 'R1 a 0 1', '.save v(a)', '.tran 1p 1n 0 1p', '.end']
  /** Deck with one extra line before `.save`. */
  const withLine = (line: string): string => [...base.slice(0, 3), line, ...base.slice(3)].join('\n')
  assert.throws(() => xyceDeck(withLine('B1 a 0 I={pwl(min(max(V(a),-2),1),-1,0,1,1)}'), { mutual: 'vcvs', printFile: 'w.csv' }), /leaves its table/)
  assert.throws(() => xyceDeck(withLine('B1 a 0 I={pwl(V(a),-1,0,1,1)}'), { mutual: 'vcvs', printFile: 'w.csv' }), /Unclamped/)
  assert.throws(() => xyceDeck(withLine('T1 a 0 b 0 z0=50 td=1n'), { mutual: 'vcvs', printFile: 'w.csv' }), /Untranslated element/)
  assert.throws(() => xyceDeck(withLine('.control'), { mutual: 'vcvs', printFile: 'w.csv' }), /Untranslated control/)
  assert.throws(() => xyceDeck(base.join('\n').replace('reltol=1e-4', 'gmin=1e-12'), { mutual: 'vcvs', printFile: 'w.csv' }), /Untranslated ngspice options: gmin/)
  assert.throws(() => xyceDeck(base.join('\n').replace('.save v(a)', '.save i(v1)'), { mutual: 'vcvs', printFile: 'w.csv' }), /saves no node voltages/)
  assert.equal(spiceValue('2.5meg'), 2.5e6)
  assert.equal(spiceValue('4n'), 4e-9)
})

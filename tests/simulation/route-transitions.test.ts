import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalInductance } from '../../src/simulation'
import { channelSpice } from '../../src/extraction'

test('explicit vertical terminal corrections preserve geometry scaling, reciprocity and passive coupling', () => {
  const line = [[.55e-6, .22e-6], [.22e-6, .55e-6]]
  const positions: [number, number][] = [[0, 0], [0, .3]]
  const matrix = terminalInductance({ height: .4, width: .15, depth: .075, positions, perLength: line })
  assert.ok(matrix[0][0] > .09e-9 && matrix[0][0] < .11e-9)
  assert.ok(matrix[0][1] > .01e-9 && matrix[0][1] < .025e-9)
  assert.equal(matrix[0][1], matrix[1][0])
  const scaled = terminalInductance({ height: .8, width: .3, depth: .15, positions: [[0, 0], [0, .6]], perLength: line })
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) assert.ok(Math.abs(scaled[i][j] - 2 * matrix[i][j]) < 1e-24)
  const channel = { R: [[1]], L: [[1e-9]], C: [[1e-12]] }
  const deck = channelSpice({ extracted: [channel], sections: 1, terminals: { input: [[.1e-9]], output: [[.2e-9]] } })
  assert.match(deck, /^L0_0 R0_0 OUT0 1.3e-9$/m)
  assert.throws(() => channelSpice({ extracted: [channel], sections: 1, terminals: { input: matrix } }), /dimensions disagree/)
  assert.throws(() => terminalInductance({ height: 0, width: .15, depth: .075, positions, perLength: line }), /dimensions/)
  assert.throws(() => terminalInductance({ height: .4, width: .15, depth: .075, positions: [[0, 0], [0, .1]], perLength: line }), /overlap/)
})

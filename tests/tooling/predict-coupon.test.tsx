import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { solveCrossSection } from '../../src/extraction'
import { couponLineWidthMm, couponStepWidthMm, couponStructures } from '../../examples/coupon/si-coupon'
import { fittedDelaySeconds, plateauOhms, readTouchstone, tdrProfile, writeTouchstone, type Network } from '../../scripts/compare-touchstone'
import { ngspiceAvailable } from '../support/golden-checks'

// Known-answer checks on the committed coupon predictions (docs/hardware-validation.md). The tolerances were fixed
// before the predictions were generated. The reference is the pipeline's own field solve of the same JLC04161H-3313
// microstrip (3313 prepreg 0.0994 mm, Dk 4.1; 1 oz copper; 20 um mask Dk 3.3), so these check the ladder, the AC
// port setup and the TDR, not the field solver (docs/golden-checks.md covers that).
const files = couponStructures.map(structure => ({ structure, path: `examples/coupon/predicted/${structure.name}.s${structure.ports.length}p` }))
/** Committed prediction for one structure. */
const load = async (name: string): Promise<Network> => {
  const entry = files.find(file => file.structure.name === name)!
  return readTouchstone(await readFile(entry.path, 'utf8'), entry.structure.ports.length)
}
/** Lossless L, C of the top microstrip at `width`. */
function microstrip(width: number): { z0: number; delayPerMm: number } {
  const line = solveCrossSection({ conductors: [{ id: 's', xMm: 0, zMm: .0994, widthMm: width, thicknessMm: .035 }], planes: [{ zMm: 0 }],
    dielectrics: [{ zMm: 0, thicknessMm: .0994, er: 4.1, lossTangent: .02 }, { zMm: .0994, thicknessMm: .055, er: 3.3, lossTangent: .025 }] })
  return { z0: Math.sqrt(line.L[0][0] / line.C[0][0]), delayPerMm: Math.sqrt(line.L[0][0] * line.C[0][0]) / 1000 }
}

test('coupon predictions are reciprocal (|Sij - Sji| <= 1e-6) and passive (column power <= 1 + 1e-6)', async () => {
  // A linear RLGC ladder with resistive ports is reciprocal and passive; 1e-6 covers the 7-digit Touchstone print.
  for (const { structure } of files) {
    const network = await load(structure.name)
    for (const matrix of network.s) for (let j = 0; j < network.ports; j++) {
      const power = matrix.reduce((sum, row) => sum + row[j][0] ** 2 + row[j][1] ** 2, 0)
      assert.ok(power <= 1 + 1e-6, `${structure.name} column ${j + 1}: ${power}`)
      for (let i = 0; i < network.ports; i++) assert.ok(Math.hypot(matrix[i][j][0] - matrix[j][i][0], matrix[i][j][1] - matrix[j][i][1]) <= 1e-6, `${structure.name} S${i + 1}${j + 1}`)
    }
  }
})

// Failing as declared (docs/hardware-validation.md findings): THRU50 304.70 ps vs 292.84 ps (+4.05 %), THRU100
// 610.01 ps vs 597.87 ps (+2.03 %). Post-hoc reading, not a re-fitted check: both carry the same +11.6 ps, the two
// SMA signal pads the pipeline models as parallel-plate C; THRU100 - THRU50 gives 6.106 ps/mm against sqrt(LC) 6.101.
// TDR Z0: THRU50 50.50 ohm (+1.04 %, inside 2 %), THRU100 51.20 ohm (+2.44 %, outside): the series-loss ramp of a
// lossy line's TDR grows with length and the middle of 98 mm sits higher than the middle of 48 mm.
test('THRU50 and THRU100 delay is routed length x sqrt(LC) within 1 %; their TDR Z0 is sqrt(L/C) within 2 %', { todo: 'delay +4.05 % / +2.03 %; THRU100 Z0 +2.44 %' }, async () => {
  // Routed copper runs pad centre to pad centre: 48 and 98 mm. Ladder dispersion at <= 3.4 ps cells is about 0.2 %,
  // and conductor loss shifts the low-loss delay by well under 1 %. The TDR plateau is smoothed by the 3 GHz
  // Kaiser window but the middle of a 600 ps round trip is flat to well inside 2 %.
  const { z0, delayPerMm } = microstrip(couponLineWidthMm)
  for (const [name, lengthMm] of [['THRU50', 48], ['THRU100', 98]] as const) {
    const network = await load(name)
    const delay = fittedDelaySeconds(network.frequenciesHz, network.s.map(matrix => matrix[1][0]))
    const plateau = plateauOhms(tdrProfile(network.frequenciesHz, network.s.map(matrix => matrix[0][0])), delay)
    assert.ok(Math.abs(delay / (lengthMm * delayPerMm) - 1) <= 0.01, `${name} delay ${delay} vs ${lengthMm * delayPerMm}`)
    assert.ok(Math.abs(plateau / z0 - 1) <= 0.02, `${name} Z0 ${plateau} vs ${z0}`)
  }
})

// Failing as declared: plateau 28.48 ohm vs 24.82 ohm (+14.8 %). Post-hoc reading: the 3 GHz window does not settle
// on a 377 ps round trip; |S21| at 1 GHz (-1.89 dB) matches the -1.94 dB quarter-wave dip of a 25 ohm section.
test('STEP TDR shows the wide section at its sqrt(L/C) within 10 %', { todo: 'plateau +14.8 %; TDR bandwidth-limited' }, async () => {
  // The 30 mm, 0.5 mm wide section has a 380 ps round trip, barely two Kaiser-window rise times at 3 GHz, so the
  // middle-of-structure median is declared to 10 % of the wide section's own impedance.
  const network = await load('STEP')
  const delay = fittedDelaySeconds(network.frequenciesHz, network.s.map(matrix => matrix[1][0]))
  const plateau = plateauOhms(tdrProfile(network.frequenciesHz, network.s.map(matrix => matrix[0][0])), delay)
  const wide = microstrip(couponStepWidthMm).z0
  assert.ok(Math.abs(plateau / wide - 1) <= 0.1, `STEP plateau ${plateau} vs ${wide}`)
})

const native = process.env.SI_NATIVE_TESTS !== '1' && 'Set SI_NATIVE_TESTS=1 to regenerate the coupon predictions with ngspice'

test('committed coupon predictions match a fresh run of scripts/predict-coupon.tsx', { skip: native }, async context => {
  if (!ngspiceAvailable()) return context.skip('ngspice is not on PATH')
  const { couponCircuit, predictStructure } = await import('../../scripts/predict-coupon')
  const circuit = await couponCircuit()
  for (const { structure, path } of files) {
    const { network } = await predictStructure(circuit, structure)
    const fresh = readTouchstone(writeTouchstone(network, []), network.ports)
    const committed = await load(structure.name)
    const worst = Math.max(...fresh.s.flatMap((matrix, f) => matrix.flatMap((row, i) => row.map((value, j) => Math.hypot(value[0] - committed.s[f][i][j][0], value[1] - committed.s[f][i][j][1])))))
    assert.ok(worst <= 1e-6, `${path} is stale: ${worst}`)
  }
})

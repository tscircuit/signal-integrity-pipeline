import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compareNetworks, compareTolerances, fittedDelaySeconds, plateauOhms, readTouchstone, tdrProfile, writeTouchstone, type Complex, type Network } from '../../scripts/compare-touchstone'

// Expected values and tolerances below were fixed before the committed predictions were generated.
/** Committed prediction for one structure. */
const predicted = (name: string, ports: number = 2): Promise<Network> => readFile(`examples/coupon/predicted/${name}.s${ports}p`, 'utf8').then(text => readTouchstone(text, ports))

/** Complex product. */
const mul = (a: Complex, b: Complex): Complex => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
/** Complex sum. */
const add = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]]
/** Complex difference. */
const sub = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]]
/** Complex times a real. */
const scale = (a: Complex, k: number): Complex => [a[0] * k, a[1] * k]
/** Complex quotient. */
const div = (a: Complex, b: Complex): Complex => scale(mul(a, [b[0], -b[1]]), 1 / (b[0] * b[0] + b[1] * b[1]))
/** Complex exponential. */
const exp = (a: Complex): Complex => scale([Math.cos(a[1]), Math.sin(a[1])], Math.exp(a[0]))
type M2 = [[Complex, Complex], [Complex, Complex]]
/** 2x2 complex inverse. */
function inverse(m: M2): M2 {
  const det = sub(mul(m[0][0], m[1][1]), mul(m[0][1], m[1][0]))
  return [[div(m[1][1], det), div(scale(m[0][1], -1), det)], [div(scale(m[1][0], -1), det), div(m[0][0], det)]]
}
/** 2x2 complex product. */
function times(a: M2, b: M2): M2 {
  return [0, 1].map(i => [0, 1].map(j => add(mul(a[i][0], b[0][j]), mul(a[i][1], b[1][j])))) as M2
}

/** Every impedance of the network scaled by k at unchanged propagation: Z -> kZ, through S <-> Z at the reference. */
function scaleImpedance(network: Network, k: number): Network {
  const z0 = network.referenceOhms
  const one: Complex = [1, 0]
  const zero: Complex = [0, 0]
  const s = network.s.map(matrix => {
    const S = matrix as M2
    const I: M2 = [[one, zero], [zero, one]]
    const plus = [0, 1].map(i => [0, 1].map(j => add(I[i][j], S[i][j]))) as M2
    const minus = [0, 1].map(i => [0, 1].map(j => sub(I[i][j], S[i][j]))) as M2
    const Z = times(plus, inverse(minus)).map(row => row.map(value => scale(value, z0 * k))) as M2
    const numerator = [0, 1].map(i => [0, 1].map(j => sub(Z[i][j], i === j ? [z0, 0] : zero))) as M2
    const denominator = [0, 1].map(i => [0, 1].map(j => add(Z[i][j], i === j ? [z0, 0] : zero))) as M2
    return times(numerator, inverse(denominator))
  })
  return { ...network, s }
}

/** Ideal lossy line (Z0, delay, loss in dB at 1 GHz scaling as sqrt(f)) between reference ports, on the coupon sweep. */
function analyticLine(z: number, delaySeconds: number, dbAt1GHz: number): Network {
  const frequenciesHz = Array.from({ length: 201 }, (_, i) => 50e3 + i * (3e9 - 50e3) / 200)
  const s = frequenciesHz.map(f => {
    const alpha = dbAt1GHz / 8.686 * Math.sqrt(f / 1e9)
    const gl: Complex = [alpha, 2 * Math.PI * f * delaySeconds]
    const e1 = exp(scale(gl, -1))
    const e2 = mul(e1, e1)
    const rho = (z - 50) / (z + 50)
    const denominator = sub([1, 0], scale(e2, rho * rho))
    const s11 = div(scale(sub([1, 0], e2), rho), denominator)
    const s21 = div(scale(e1, 1 - rho * rho), denominator)
    return [[s11, s21], [s21, s11]]
  })
  return { ports: 2, referenceOhms: 50, frequenciesHz, s }
}

test('Touchstone writes and reads back RI data for 2- and 4-port networks', async () => {
  for (const [name, ports] of [['THRU50', 2], ['PAIR', 4]] as const) {
    const network = await predicted(name, ports)
    const again = readTouchstone(writeTouchstone(network, ['round trip']), ports)
    assert.deepEqual(again.frequenciesHz, network.frequenciesHz)
    const worst = Math.max(...again.s.flatMap((matrix, f) => matrix.flatMap((row, i) => row.map((value, j) => Math.hypot(value[0] - network.s[f][i][j][0], value[1] - network.s[f][i][j][1])))))
    assert.ok(worst <= 1e-6, `${name}: ${worst}`)
  }
  const ma = readTouchstone('! test\n# GHz S MA R 50\n1 0.5 0 0.9 -90 0.9 -90 0.5 0\n2 0.5 0 0.8 -180 0.8 -180 0.5 0\n', 2)
  assert.equal(ma.frequenciesHz[1], 2e9)
  assert.ok(Math.abs(ma.s[0][1][0][1] + 0.9) < 1e-12, 'S21 sits in the second 2-port column pair')
  assert.throws(() => readTouchstone('# Hz S RI R 50\n1 2 3\n', 2), /multiple of 9/)
})

test('TDR and delay recover a known line: Z0 within 1 %, delay within 0.5 %', () => {
  // 201 points to 3 GHz with the Kaiser beta 6 window: the plateau mid-line has settled well inside 1 %, and the
  // least-squares phase slope of an ideal line is exact apart from the small mismatch ripple (<0.5 % at 55 ohm).
  for (const z of [45, 50, 55]) {
    const line = analyticLine(z, 300e-12, 0.5)
    const s21 = line.s.map(matrix => matrix[1][0])
    const delay = fittedDelaySeconds(line.frequenciesHz, s21)
    const tdr = tdrProfile(line.frequenciesHz, line.s.map(matrix => matrix[0][0]))
    assert.ok(Math.abs(delay / 300e-12 - 1) <= 0.005, `delay ${delay}`)
    assert.ok(Math.abs(plateauOhms(tdr, delay) / z - 1) <= 0.01, `Z0 ${plateauOhms(tdr, delay)} vs ${z}`)
  }
})

test('a prediction compared with itself passes every check with zero error', async () => {
  const thru = await predicted('THRU50')
  const result = compareNetworks(thru, thru, [1, 2], { measured: await predicted('FIX2X'), predicted: await predicted('FIX2X') })
  assert.equal(result.pass, true)
  assert.ok(result.s21.maxErrorDb < 1e-9 && Math.abs(result.delay!.error) < 1e-9 && Math.abs(result.z0!.error) < 1e-9 && result.tdr!.maxErrorOhms < 1e-9)
})

test('a 10 % impedance error in the measured file fails the Z0 check and reports the measured Z0', async () => {
  const thru = await predicted('THRU50')
  const result = compareNetworks(scaleImpedance(thru, 1.1), thru)
  assert.equal(result.z0!.pass, false)
  assert.equal(result.pass, false)
  assert.ok(Math.abs(result.z0!.error - 0.1) <= 0.02, `Z0 error ${result.z0!.error}`)
  assert.ok(Math.abs(result.z0!.measured / (1.1 * result.z0!.predicted) - 1) <= 0.02)
  // The same line at +4 % stays inside the 5 % tolerance.
  assert.equal(compareNetworks(scaleImpedance(thru, 1.04), thru).z0!.pass, true)
})

test('a 5 % longer delay and 1.5 dB extra loss each fail their own check', async () => {
  const thru = await predicted('THRU50')
  const delay = fittedDelaySeconds(thru.frequenciesHz, thru.s.map(matrix => matrix[1][0]))
  /** Multiply every S21/S12 by exp(-j w extra) * gain. */
  const alter = (extraSeconds: number, gainDb: number): Network => ({ ...thru, s: thru.s.map((matrix, f) => matrix.map((row, i) => row.map((value, j) => i === j ? value : scale(mul(value, exp([0, -2 * Math.PI * thru.frequenciesHz[f] * extraSeconds])), 10 ** (gainDb / 20))))) })
  const slow = compareNetworks(alter(0.05 * delay, 0), thru)
  assert.equal(slow.delay!.pass, false)
  assert.ok(Math.abs(slow.delay!.error - 0.05) <= 0.002, `delay error ${slow.delay!.error}`)
  assert.equal(slow.s21.pass, true)
  const lossy = compareNetworks(alter(0, -1.5), thru)
  assert.equal(lossy.s21.pass, false)
  assert.ok(Math.abs(lossy.s21.maxErrorDb - 1.5) < 1e-6)
  assert.equal(lossy.delay!.pass, true)
  assert.equal(compareTolerances.s21Db, 1)
})

test('NEXT and FEXT paths report |S21| only', async () => {
  const pair = await predicted('PAIR', 4)
  const next = { ...pair, ports: 2, s: pair.s.map(matrix => [[matrix[0][0], matrix[0][2]], [matrix[2][0], matrix[2][2]]]) }
  const result = compareNetworks(next, pair, [1, 3])
  assert.equal(result.thru, false)
  assert.equal(result.delay, undefined)
  assert.equal(result.pass, true)
})

/**
 * Compare a measured Touchstone file with the pipeline's prediction.
 *
 *   tsx scripts/compare-touchstone.ts --measured thru50.s2p --predicted examples/coupon/predicted/THRU50.s2p \
 *     [--ports 1,2] [--fixture-measured fix2x.s2p --fixture-predicted examples/coupon/predicted/FIX2X.s2p] [--json]
 *
 * `--ports a,b` picks which predicted ports the measured 2-port's port 1 and port 2 were connected to (for the
 * 4-port PAIR: 1,2 thru, 1,3 NEXT, 1,4 FEXT). The fixture pair divides both S21s by their own 2x-thru S21, which
 * removes the connectors and launches from the delay and loss checks. Exit code 1 when any applicable check fails.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Complex = [number, number]
/** S-parameters at each frequency: s[frequency][to][from], referenced to `referenceOhms` at every port. */
export interface Network { ports: number; referenceOhms: number; frequenciesHz: number[]; s: Complex[][][] }
export interface TdrProfile { timesSeconds: number[]; impedanceOhms: number[] }

/**
 * Pass/fail tolerances, fixed before any board exists.
 * - z0Fraction 5 %: JLC's impedance control is +-10 %, so a coupon can legitimately miss nominal by 10 %; the check
 *   compares measured TDR Z0 with the prediction for the as-designed geometry and also reports the measured Z0, so a
 *   fab miss shows as a number rather than a silent pass. 5 % is half the fab band: the field solver itself agrees
 *   with exact stripline answers to 0.23 % (docs/golden-checks.md #2), so most of the 5 % is laminate Dk and etch.
 * - delayFraction 3 %: delay scales with sqrt(effective Dk); a 3 % delay error is a 6 % effective-Dk error, about
 *   the spread between JLC's published Dk (4.1 for 3313 prepreg) and typical FR-4 datasheet values at 1-3 GHz.
 * - s21Db 1 dB up to 2 GHz: a 50 mm FR-4 microstrip loses about 1-2 dB at 2 GHz; 1 dB bounds loss-tangent and
 *   roughness error (the model omits roughness) while the NanoVNA V2's own S21 uncertainty is a few tenths of a dB.
 */
export const compareTolerances = { z0Fraction: 0.05, delayFraction: 0.03, s21Db: 1, s21MaxHz: 2e9 } as const

const unitScale: Record<string, number> = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }

/** Parse Touchstone v1 (`# <unit> S <RI|MA|DB> R <ohms>`); 2-port data use the v1 order S11 S21 S12 S22. */
export function readTouchstone(text: string, ports: number): Network {
  let unit = 1e9
  let format = 'MA'
  let referenceOhms = 50
  const numbers: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/!.*/, '').trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const words = line.slice(1).trim().toUpperCase().split(/\s+/)
      for (const [i, word] of words.entries()) {
        if (word in unitScale) unit = unitScale[word]
        else if (['RI', 'MA', 'DB'].includes(word)) format = word
        else if (word === 'R') referenceOhms = Number(words[i + 1])
      }
      if (!words.includes('S')) throw new Error(`Only S-parameter Touchstone files are supported: ${line}`)
      continue
    }
    for (const token of line.split(/\s+/)) {
      const value = Number(token)
      if (!Number.isFinite(value)) throw new Error(`Bad Touchstone number "${token}"`)
      numbers.push(value)
    }
  }
  const record = 1 + 2 * ports * ports
  if (!numbers.length || numbers.length % record) throw new Error(`Touchstone data length ${numbers.length} is not a multiple of ${record} for ${ports} ports`)
  const frequenciesHz: number[] = []
  const s: Complex[][][] = []
  for (let offset = 0; offset < numbers.length; offset += record) {
    frequenciesHz.push(numbers[offset] * unit)
    const matrix: Complex[][] = Array.from({ length: ports }, () => Array.from({ length: ports }, (): Complex => [0, 0]))
    for (let k = 0; k < ports * ports; k++) {
      const a = numbers[offset + 1 + 2 * k]
      const b = numbers[offset + 2 + 2 * k]
      const row = ports === 2 ? k % 2 : Math.floor(k / ports)
      const column = ports === 2 ? Math.floor(k / 2) : k % ports
      const magnitude = format === 'DB' ? 10 ** (a / 20) : a
      matrix[row][column] = format === 'RI' ? [a, b] : [magnitude * Math.cos(b * Math.PI / 180), magnitude * Math.sin(b * Math.PI / 180)]
    }
    s.push(matrix)
  }
  return { ports, referenceOhms, frequenciesHz, s }
}

/** Touchstone v1 text in Hz and RI, one frequency per line (2-port order S11 S21 S12 S22). */
export function writeTouchstone(network: Network, comments: string[]): string {
  const { ports } = network
  const lines = [...comments.map(comment => `! ${comment}`), `# HZ S RI R ${network.referenceOhms}`]
  /** Fixed 7-significant-digit number. */
  const number = (value: number): string => value.toPrecision(7)
  for (const [i, frequency] of network.frequenciesHz.entries()) {
    const order = ports === 2 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : Array.from({ length: ports * ports }, (_, k) => [Math.floor(k / ports), k % ports])
    lines.push([String(frequency), ...order.flatMap(([row, column]) => network.s[i][row][column].map(number))].join(' '))
  }
  return lines.join('\n') + '\n'
}

/** Zeroth-order modified Bessel function I0, by its power series (converges for every real argument). */
function besselI0(x: number): number {
  let term = 1
  let total = 1
  for (let k = 1; k < 200 && term > 1e-17 * total; k++) {
    term *= (x / (2 * k)) ** 2
    total += term
  }
  return total
}

/**
 * Low-pass step TDR from S11, as NanoVNA-Saver computes it (src/NanoVNASaver/Windows/TDR.py, updateTDR and
 * _tdr_lowpass): the first sample stands in for DC, the spectrum is mirrored to a real impulse, a symmetric Kaiser
 * window (beta 6 is its "Normal" choice) tapers it, the inverse DFT gives the impulse, its running sum the step
 * reflection rho, and Z = Z0 (1 + rho) / (1 - rho). Needs a linear sweep starting near DC.
 */
export function tdrProfile(frequenciesHz: number[], s11: Complex[], referenceOhms: number = 50, options: { beta?: number; stepSeconds?: number; spanSeconds?: number } = {}): TdrProfile {
  const count = frequenciesHz.length
  if (count < 3) throw new Error('TDR needs at least three frequencies')
  const spacing = (frequenciesHz.at(-1)! - frequenciesHz[0]) / (count - 1)
  if (frequenciesHz.some((frequency, i) => Math.abs(frequency - frequenciesHz[0] - i * spacing) > 1e-6 * spacing)) throw new Error('TDR needs a linear frequency sweep')
  if (frequenciesHz[0] > 0.5 * spacing) throw new Error('TDR needs a sweep that starts near DC (first frequency below half the step)')
  const beta = options.beta ?? 6
  const step = options.stepSeconds ?? 2e-12
  const span = Math.min(options.spanSeconds ?? 5e-9, 0.5 / spacing)
  const weights = s11.map((_, k) => besselI0(beta * Math.sqrt(1 - (k / (count - 1)) ** 2)) / besselI0(beta))
  const samples = 1 / (spacing * step)
  const timesSeconds: number[] = []
  const impedanceOhms: number[] = []
  let reflection = 0
  // The windowed impulse is symmetric about t = 0, so half of a reflection at the reference plane lies at negative
  // time. Integrating from -lead keeps it (NanoVNA-Saver adds the reversed step for the same reason).
  const lead = Math.ceil(Math.min(1e-9, 0.25 / spacing) / step)
  for (let n = -lead; n * step <= span; n++) {
    let impulse = weights[0] * s11[0][0]
    for (let k = 1; k < count; k++) {
      const angle = 2 * Math.PI * k * n / samples
      impulse += 2 * weights[k] * (s11[k][0] * Math.cos(angle) - s11[k][1] * Math.sin(angle))
    }
    reflection += impulse / samples
    if (n < 0) continue
    timesSeconds.push(n * step)
    impedanceOhms.push(referenceOhms * (1 + reflection) / (1 - reflection))
  }
  return { timesSeconds, impedanceOhms }
}

/** Phase in radians, unwrapped along the sweep. */
function unwrappedPhase(values: Complex[]): number[] {
  const phase: number[] = []
  for (const [i, [re, im]] of values.entries()) {
    let angle = Math.atan2(im, re)
    if (i) while (angle - phase[i - 1] > Math.PI) angle -= 2 * Math.PI
    if (i) while (angle - phase[i - 1] < -Math.PI) angle += 2 * Math.PI
    phase.push(angle)
  }
  return phase
}

/** Complex quotient a / b. */
function divide(a: Complex, b: Complex): Complex {
  const scale = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / scale, (a[1] * b[0] - a[0] * b[1]) / scale]
}

/** Linear interpolation of magnitude and unwrapped phase onto new frequencies (inside the source sweep only). */
function resample(frequenciesHz: number[], values: Complex[], targets: number[]): Complex[] {
  const phase = unwrappedPhase(values)
  const magnitude = values.map(([re, im]) => Math.hypot(re, im))
  return targets.map(target => {
    if (target < frequenciesHz[0] - 1e-6 || target > frequenciesHz.at(-1)! + 1e-6) throw new Error(`Frequency ${target} Hz is outside the prediction sweep`)
    let i = 1
    while (i < frequenciesHz.length - 1 && frequenciesHz[i] < target) i++
    const t = Math.max(0, Math.min(1, (target - frequenciesHz[i - 1]) / (frequenciesHz[i] - frequenciesHz[i - 1])))
    const m = magnitude[i - 1] + t * (magnitude[i] - magnitude[i - 1])
    const p = phase[i - 1] + t * (phase[i] - phase[i - 1])
    return [m * Math.cos(p), m * Math.sin(p)]
  })
}

/** Least-squares delay -d(phase)/d(omega) of S21 over (0, maxHz], with a free phase offset. */
export function fittedDelaySeconds(frequenciesHz: number[], s21: Complex[], maxHz: number = compareTolerances.s21MaxHz): number {
  const phase = unwrappedPhase(s21)
  const used = frequenciesHz.flatMap((frequency, i) => (frequency > 0 && frequency <= maxHz ? [[frequency, phase[i]]] : []))
  const meanF = used.reduce((sum, [f]) => sum + f, 0) / used.length
  const meanP = used.reduce((sum, [, p]) => sum + p, 0) / used.length
  const slope = used.reduce((sum, [f, p]) => sum + (f - meanF) * (p - meanP), 0) / used.reduce((sum, [f]) => sum + (f - meanF) ** 2, 0)
  return -slope / (2 * Math.PI)
}

/** Median TDR impedance over the middle of the structure: 0.3 to 0.7 of its round trip 2 tau. */
export function plateauOhms(profile: TdrProfile, delaySeconds: number): number {
  const values = profile.impedanceOhms.filter((_, i) => profile.timesSeconds[i] >= 0.6 * delaySeconds && profile.timesSeconds[i] <= 1.4 * delaySeconds).sort((a, b) => a - b)
  if (!values.length) throw new Error('TDR span does not cover the structure')
  return values[Math.floor(values.length / 2)]
}

export interface S21Row { frequencyHz: number; measuredDb: number; predictedDb: number; errorDb: number; phaseErrorDegrees: number }
export interface Check { measured: number; predicted: number; error: number; tolerance: number; pass: boolean }
export interface Comparison {
  ports: [number, number]
  thru: boolean
  rows: S21Row[]
  s21: { maxErrorDb: number; atHz: number; tolerance: number; pass: boolean }
  delay?: Check
  z0?: Check
  tdr?: { rmsErrorOhms: number; maxErrorOhms: number; shiftSeconds: number }
  pass: boolean
}

/** The S_ba column of a network along its sweep. */
function column(network: Network, to: number, from: number): Complex[] {
  return network.s.map(matrix => matrix[to][from])
}

/**
 * Measured 2-port against the predicted ports [a, b] (1-based). Applicable checks: |S21| always; delay, TDR Z0 and
 * the TDR profile only for a thru path (|S_ba| above 0.5 at the lowest frequency), not for NEXT/FEXT.
 */
export function compareNetworks(measured: Network, predicted: Network, ports: [number, number] = [1, 2], fixtures?: { measured: Network; predicted: Network }): Comparison {
  if (measured.ports !== 2) throw new Error('The measured file must be a 2-port (.s2p)')
  if (measured.referenceOhms !== predicted.referenceOhms) throw new Error('Measured and predicted reference impedances differ')
  const [a, b] = [ports[0] - 1, ports[1] - 1]
  if (![a, b].every(port => port >= 0 && port < predicted.ports) || a === b) throw new Error(`Ports ${ports.join(',')} do not fit a ${predicted.ports}-port prediction`)
  const frequencies = measured.frequenciesHz.filter(frequency => frequency >= predicted.frequenciesHz[0] && frequency <= predicted.frequenciesHz.at(-1)!)
  const measuredRaw = column(measured, 1, 0).filter((_, i) => frequencies.includes(measured.frequenciesHz[i]))
  const predictedRaw = resample(predicted.frequenciesHz, column(predicted, b, a), frequencies)
  const measuredS21 = fixtures ? measuredRaw.map((value, i) => divide(value, resample(fixtures.measured.frequenciesHz, column(fixtures.measured, 1, 0), frequencies)[i])) : measuredRaw
  const predictedS21 = fixtures ? predictedRaw.map((value, i) => divide(value, resample(fixtures.predicted.frequenciesHz, column(fixtures.predicted, 1, 0), frequencies)[i])) : predictedRaw
  /** dB magnitude. */
  const db = ([re, im]: Complex): number => 20 * Math.log10(Math.hypot(re, im))
  const measuredPhase = unwrappedPhase(measuredS21)
  const predictedPhase = unwrappedPhase(predictedS21)
  const rows = frequencies.map((frequencyHz, i) => ({ frequencyHz, measuredDb: db(measuredS21[i]), predictedDb: db(predictedS21[i]), errorDb: db(measuredS21[i]) - db(predictedS21[i]), phaseErrorDegrees: (measuredPhase[i] - predictedPhase[i]) * 180 / Math.PI }))
  const band = rows.filter(row => row.frequencyHz <= compareTolerances.s21MaxHz)
  const worst = band.reduce((max, row) => (Math.abs(row.errorDb) > Math.abs(max.errorDb) ? row : max), band[0])
  const s21 = { maxErrorDb: Math.abs(worst.errorDb), atHz: worst.frequencyHz, tolerance: compareTolerances.s21Db, pass: Math.abs(worst.errorDb) <= compareTolerances.s21Db }
  const thru = Math.hypot(...predictedRaw[0]) > 0.5
  if (!thru) return { ports, thru, rows, s21, pass: s21.pass }
  /** One relative check. */
  const check = (value: number, reference: number, tolerance: number): Check => ({ measured: value, predicted: reference, error: value / reference - 1, tolerance, pass: Math.abs(value / reference - 1) <= tolerance })
  const delay = check(fittedDelaySeconds(frequencies, measuredS21), fittedDelaySeconds(frequencies, predictedS21), compareTolerances.delayFraction)
  const measuredDelay = fittedDelaySeconds(frequencies, measuredRaw)
  const predictedDelay = fittedDelaySeconds(frequencies, predictedRaw)
  const measuredTdr = tdrProfile(measured.frequenciesHz, column(measured, 0, 0), measured.referenceOhms)
  const predictedTdr = tdrProfile(predicted.frequenciesHz, column(predicted, a, a), predicted.referenceOhms)
  const z0 = check(plateauOhms(measuredTdr, measuredDelay), plateauOhms(predictedTdr, predictedDelay), compareTolerances.z0Fraction)
  // Connectors delay the measured trace by their round trip: tau_measured - tau_predicted.
  const shiftSeconds = measuredDelay - predictedDelay
  const errors = predictedTdr.timesSeconds.flatMap((time, i) => {
    if (time > 2 * predictedDelay) return []
    const shifted = time + shiftSeconds
    const j = measuredTdr.timesSeconds.findIndex(t => t >= shifted)
    if (j < 0) return []
    if (j === 0) return [measuredTdr.impedanceOhms[0] - predictedTdr.impedanceOhms[i]]
    const [t0, t1] = [measuredTdr.timesSeconds[j - 1], measuredTdr.timesSeconds[j]]
    const [z0, z1] = [measuredTdr.impedanceOhms[j - 1], measuredTdr.impedanceOhms[j]]
    return [z0 + (z1 - z0) * (shifted - t0) / (t1 - t0) - predictedTdr.impedanceOhms[i]]
  })
  const tdr = { rmsErrorOhms: Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length), maxErrorOhms: Math.max(...errors.map(Math.abs)), shiftSeconds }
  return { ports, thru, rows, s21, delay, z0, tdr, pass: s21.pass && delay.pass && z0.pass }
}

/** Human-readable report: the three checks, then |S21| and phase error every ~250 MHz. */
export function formatComparison(result: Comparison): string {
  /** Pass/fail word. */
  const verdict = (pass: boolean): string => (pass ? 'PASS' : 'FAIL')
  const lines = [`ports ${result.ports.join(',')} (${result.thru ? 'thru' : 'coupled'})`,
    `|S21| max error ${result.s21.maxErrorDb.toFixed(3)} dB at ${(result.s21.atHz / 1e9).toFixed(3)} GHz (tolerance ${result.s21.tolerance} dB up to ${compareTolerances.s21MaxHz / 1e9} GHz): ${verdict(result.s21.pass)}`]
  if (result.delay) lines.push(`delay measured ${(result.delay.measured * 1e12).toFixed(2)} ps, predicted ${(result.delay.predicted * 1e12).toFixed(2)} ps, error ${(result.delay.error * 100).toFixed(2)} % (tolerance ${result.delay.tolerance * 100} %): ${verdict(result.delay.pass)}`)
  if (result.z0) lines.push(`TDR Z0 measured ${result.z0.measured.toFixed(2)} ohm, predicted ${result.z0.predicted.toFixed(2)} ohm, error ${(result.z0.error * 100).toFixed(2)} % (tolerance ${result.z0.tolerance * 100} %): ${verdict(result.z0.pass)}`)
  if (result.tdr) lines.push(`TDR profile error rms ${result.tdr.rmsErrorOhms.toFixed(2)} ohm, max ${result.tdr.maxErrorOhms.toFixed(2)} ohm (measured shifted by ${(result.tdr.shiftSeconds * 1e12).toFixed(1)} ps)`)
  lines.push('frequency_GHz measured_dB predicted_dB error_dB phase_error_deg')
  let next = 0
  for (const row of result.rows) if (row.frequencyHz >= next) {
    lines.push([(row.frequencyHz / 1e9).toFixed(3), row.measuredDb.toFixed(3), row.predictedDb.toFixed(3), row.errorDb.toFixed(3), row.phaseErrorDegrees.toFixed(2)].join(' '))
    next = row.frequencyHz + 2.5e8
  }
  lines.push(`overall: ${verdict(result.pass)}`)
  return lines.join('\n')
}

/** Port count from a .sNp file name. */
function portsOf(path: string): number {
  const match = /\.s(\d+)p$/i.exec(path)
  if (!match) throw new Error(`${path} is not a .sNp file`)
  return Number(match[1])
}

/** CLI entry; see the header comment. */
async function main(argv: string[]): Promise<number> {
  /** Value after a flag. */
  const flag = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  /** Read one Touchstone file. */
  const load = async (path: string): Promise<Network> => readTouchstone(await readFile(path, 'utf8'), portsOf(path))
  const measuredPath = flag('--measured')
  const predictedPath = flag('--predicted')
  if (!measuredPath || !predictedPath) throw new Error('Usage: compare-touchstone --measured <m.s2p> --predicted <p.sNp> [--ports a,b] [--fixture-measured <f.s2p> --fixture-predicted <f.s2p>] [--json]')
  const ports = (flag('--ports') ?? '1,2').split(',').map(Number) as [number, number]
  const fixtureMeasured = flag('--fixture-measured')
  const fixturePredicted = flag('--fixture-predicted')
  if (Boolean(fixtureMeasured) !== Boolean(fixturePredicted)) throw new Error('Give both --fixture-measured and --fixture-predicted, or neither')
  const fixtures = fixtureMeasured && fixturePredicted ? { measured: await load(fixtureMeasured), predicted: await load(fixturePredicted) } : undefined
  const result = compareNetworks(await load(measuredPath), await load(predictedPath), ports, fixtures)
  console.log(argv.includes('--json') ? JSON.stringify(result, null, 2) : formatComparison(result))
  return result.pass ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2))

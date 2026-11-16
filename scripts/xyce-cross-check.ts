// Same deck in ngspice and Xyce: do the node waveforms agree within the tolerances fixed in docs/xyce-cross-check.md?
// Usage (wrap in the machine's heavy-job lock; both simulators run serially here):
//   tsx scripts/xyce-cross-check.ts <simulation.cir> <outdir> [--mutual vcvs|native] [--capture capture.json --evidence evidence.json]
// With --capture, the ngspice side is an existing pipeline capture of the same deck and ngspice is not run.
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parseSpiceVectors } from '../src/observation'
import { xyceDeck, type XyceMutual } from './xyce-deck'

/**
 * Declared before any run (docs/xyce-cross-check.md). Each simulator bounds its local error by reltol 1e-4 of the
 * signal plus vntol 1e-6 V per step; over the ~1e4 steps of an 8 ns run that leaves both well inside 10 mV, while
 * linear interpolation between the two engines' own time points stays below a few mV on 1 ps edge steps.
 * A 50% crossing differing by 5 ps is 10 mV at the fastest edges here (about 2 mV/ps).
 */
export const CROSS_CHECK_TOLERANCE = { maximumVoltageDifference: 10e-3, crossingSeconds: 5e-12, minimumSwing: .2, hysteresis: .1 } as const

export interface Waveforms { times: number[]; nodes: Map<string, number[]> }
export interface NodeAgreement { node: string; swingV: number; maximumDifferenceV: number; crossings: number; xyceCrossings: number; maximumCrossingDifferenceS: number | null; pass: boolean }
export interface CrossCheck { pass: boolean; comparedSeconds: number; ngspicePoints: number; xycePoints: number; nodes: NodeAgreement[] }

/** Xyce `.print tran format=csv` columns keyed by lower-case name (`time`, `v(n1)`, ...). */
export function xyceColumns(text: string): Waveforms {
  const [header, ...rows] = text.trim().split(/\r?\n/)
  const names = header.split(',').map(name => name.trim().toLowerCase())
  const columns = names.map(() => [] as number[])
  for (const row of rows) row.split(',').forEach((value, i) => columns[i].push(Number(value)))
  if (names[0] !== 'time' || columns.flat().some(value => !Number.isFinite(value))) throw new Error('Expected a finite Xyce CSV with TIME first')
  return { times: columns[0], nodes: new Map(names.slice(1).map((name, i) => [name, columns[i + 1]])) }
}

/** Linear interpolation of a sampled waveform with ascending times. */
export function sampleAt(times: number[], values: number[], time: number): number {
  if (time <= times[0]) return values[0]
  if (time >= times.at(-1)!) return values.at(-1)!
  let low = 0
  let high = times.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (times[middle] <= time) low = middle
    else high = middle
  }
  return values[low] + (values[high] - values[low]) * (time - times[low]) / (times[high] - times[low])
}

/** Times where the waveform crosses `level`, counted once per excursion beyond level +/- band (hysteresis). */
export function crossings(times: number[], values: number[], level: number, band: number): number[] {
  const found: number[] = []
  let state = values[0] > level + band ? 1 : values[0] < level - band ? -1 : 0
  let last = NaN
  for (let i = 1; i < values.length; i++) {
    const [a, b] = [values[i - 1] - level, values[i] - level]
    if (a * b < 0 || (b === 0 && a !== 0)) last = times[i - 1] + (times[i] - times[i - 1]) * a / (a - b)
    const next = values[i] > level + band ? 1 : values[i] < level - band ? -1 : state
    if (next !== state && state !== 0 && Number.isFinite(last)) found.push(last)
    state = next
  }
  return found
}

/** Symmetric comparison: each engine's samples against the other's interpolant, over their common time span. */
export function compareWaveforms(ngspice: Waveforms, xyce: Waveforms, tolerance: typeof CROSS_CHECK_TOLERANCE = CROSS_CHECK_TOLERANCE): CrossCheck {
  const end = Math.min(ngspice.times.at(-1)!, xyce.times.at(-1)!)
  const nodes = [...ngspice.nodes].map(([node, reference]): NodeAgreement => {
    const other = xyce.nodes.get(node)
    if (!other) throw new Error(`Xyce printed no ${node}`)
    let difference = 0
    for (const [times, values, against, againstValues] of [[ngspice.times, reference, xyce.times, other], [xyce.times, other, ngspice.times, reference]] as const)
      for (const [i, time] of times.entries()) if (time <= end) difference = Math.max(difference, Math.abs(values[i] - sampleAt(against, againstValues, time)))
    const low = Math.min(...reference)
    const high = Math.max(...reference)
    const swing = high - low
    const timed = swing >= tolerance.minimumSwing
    const level = (low + high) / 2
    const first = timed ? crossings(ngspice.times, reference, level, tolerance.hysteresis * swing) : []
    const second = timed ? crossings(xyce.times, other, level, tolerance.hysteresis * swing) : []
    const skew = first.length === second.length && first.length ? Math.max(...first.map((time, i) => Math.abs(time - second[i]))) : null
    const timing = !timed || (first.length === second.length && (skew ?? 0) <= tolerance.crossingSeconds)
    return { node, swingV: swing, maximumDifferenceV: difference, crossings: first.length, xyceCrossings: second.length, maximumCrossingDifferenceS: skew, pass: difference <= tolerance.maximumVoltageDifference && timing }
  })
  const complete = Math.abs(ngspice.times.at(-1)! - xyce.times.at(-1)!) <= 1e-6 * end
  return { pass: complete && nodes.every(node => node.pass), comparedSeconds: end, ngspicePoints: ngspice.times.length, xycePoints: xyce.times.length, nodes }
}

/** ngspice ASCII raw (`-r waveform.raw`) node voltages. */
export function ngspiceRaw(text: string): Waveforms {
  const vectors = parseSpiceVectors(text)
  return { times: vectors.find(vector => vector.name === 'time')!.values, nodes: new Map(vectors.filter(vector => vector.name.startsWith('v(')).map(vector => [vector.name, vector.values])) }
}

/** A pipeline capture keyed back to deck nodes through its evidence probes (ground-referenced probes only). */
export function ngspiceCapture(capture: { timestampsSeconds: number[]; probes: { name: string; voltageLevels: number[] }[] }, probes: { name: string; signalNode: string; referenceNode: string }[]): Waveforms {
  const nodes = new Map<string, number[]>()
  for (const probe of capture.probes) {
    const declared = probes.find(entry => entry.name === probe.name)
    if (declared?.referenceNode === '0') nodes.set(`v(${declared.signalNode.toLowerCase()})`, probe.voltageLevels)
  }
  return { times: capture.timestampsSeconds, nodes }
}

/** Run one native tool in `cwd`, returning wall seconds and peak RSS from BSD/GNU time. */
async function timed(cwd: string, command: string, args: string[]): Promise<{ seconds: number; peakRssMiB: number | null; stdout: string }> {
  const started = performance.now()
  const flag = process.platform === 'darwin' ? '-l' : '-v'
  const { stdout, stderr } = await promisify(execFile)('/usr/bin/time', [flag, command, ...args], { cwd, maxBuffer: 1 << 30, env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', SPICE_ASCIIRAWFILE: '1' } })
  const bytes = /(\d+)\s+maximum resident set size/.exec(stderr)
  const kib = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(stderr)
  return { seconds: (performance.now() - started) / 1000, peakRssMiB: bytes ? Number(bytes[1]) / 2 ** 20 : kib ? Number(kib[1]) / 1024 : null, stdout }
}

export interface CrossCheckRun extends CrossCheck { mutual: XyceMutual; ngspice: { seconds: number; peakRssMiB: number | null } | 'capture'; xyce: { seconds: number; peakRssMiB: number | null; steps: number | null } }

/** Translate `deck`, run ngspice (unless its waveforms are given) and Xyce in `out`, compare and write report.json. */
export async function runCrossCheck(deck: string, out: string, mutual: XyceMutual, given?: Waveforms): Promise<CrossCheckRun> {
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'simulation.cir'), deck)
  await writeFile(join(out, 'xyce.cir'), xyceDeck(deck, { mutual, printFile: 'waveform.csv' }))
  let ngspice = given
  let ngspiceRun: Awaited<ReturnType<typeof timed>> | undefined
  if (!ngspice) {
    ngspiceRun = await timed(out, 'ngspice', ['-n', '-b', '-r', 'waveform.raw', 'simulation.cir'])
    await writeFile(join(out, 'ngspice.log'), ngspiceRun.stdout)
    ngspice = ngspiceRaw(await readFile(join(out, 'waveform.raw'), 'utf8'))
  }
  const xyceRun = await timed(out, process.env.XYCE ?? 'Xyce', ['xyce.cir'])
  await writeFile(join(out, 'xyce.log'), xyceRun.stdout)
  const steps = [...xyceRun.stdout.matchAll(/Number Successful Steps Taken:\s*(\d+)/g)].at(-1)?.[1]
  const result = compareWaveforms(ngspice, xyceColumns(await readFile(join(out, 'waveform.csv'), 'utf8')))
  const report: CrossCheckRun = { ...result, mutual, ngspice: ngspiceRun ? { seconds: ngspiceRun.seconds, peakRssMiB: ngspiceRun.peakRssMiB } : 'capture', xyce: { seconds: xyceRun.seconds, peakRssMiB: xyceRun.peakRssMiB, steps: steps ? Number(steps) : null } }
  await writeFile(join(out, 'report.json'), JSON.stringify({ ...report, tolerance: CROSS_CHECK_TOLERANCE }, null, 2))
  return report
}

/** CLI value after `--name`. */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

if (import.meta.main) {
  const [deckPath, outPath] = process.argv.slice(2)
  const mutual = argument('--mutual') ?? 'vcvs'
  if (!deckPath || !outPath || (mutual !== 'vcvs' && mutual !== 'native')) throw new Error('Usage: tsx scripts/xyce-cross-check.ts <simulation.cir> <outdir> [--mutual vcvs|native] [--capture capture.json --evidence evidence.json]')
  const capture = argument('--capture')
  const given = capture ? ngspiceCapture(JSON.parse(await readFile(capture, 'utf8')), JSON.parse(await readFile(argument('--evidence')!, 'utf8')).probes) : undefined
  const report = await runCrossCheck(await readFile(deckPath, 'utf8'), resolve(outPath), mutual, given)
  const failed = report.nodes.filter(node => !node.pass)
  console.log(JSON.stringify({ ...report, nodes: failed.length ? failed : `${report.nodes.length} nodes pass`, worstV: Math.max(...report.nodes.map(node => node.maximumDifferenceV)), worstCrossingS: Math.max(0, ...report.nodes.map(node => node.maximumCrossingDifferenceS ?? 0)) }, null, 2))
  process.exitCode = report.pass ? 0 : 1
}

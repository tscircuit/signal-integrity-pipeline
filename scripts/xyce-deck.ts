// Routed ngspice deck -> equivalent Xyce deck, for the solver cross-check in docs/xyce-cross-check.md.
// Usage: tsx scripts/xyce-deck.ts <in.cir> <out.cir> [--mutual native|vcvs] [--print <file.csv>]
import { readFile, writeFile } from 'node:fs/promises'

/** `vcvs`: K lines become self inductors plus one VCVS per mutual term. `native`: K lines pass through. */
export type XyceMutual = 'native' | 'vcvs'
export interface XyceDeckOptions { mutual: XyceMutual; printFile: string }

interface Inductor { line: number; name: string; from: string; to: string; henries: number }
interface Scope { inductors: Map<string, Inductor>; couplings: { first: string; second: string; factor: number }[] }

const SCALE: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
/** Parse a SPICE number with an optional engineering suffix. */
export function spiceValue(token: string): number {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|[tgkmunpf])?[a-z]*$/i.exec(token)
  if (!match) throw new Error(`Not a SPICE number: ${token}`)
  return Number(match[1]) * (match[2] ? SCALE[match[2].toLowerCase()] : 1)
}

/**
 * ngspice options -> Xyce option packages. ngspice reltol bounds both the step's local truncation error and the
 * Newton update; vntol is the absolute voltage tolerance and abstol the absolute current (residual) tolerance.
 * Xyce has one weighted update norm per package (|dx| <= reltol |x| + abstol), so abstol takes vntol and the
 * residual tolerance rhstol takes the current abstol. pivrel has no Xyce KLU equivalent and is dropped.
 */
function xyceOptions(line: string): string[] {
  const values = new Map(line.trim().split(/\s+/).slice(1).map(token => {
    const [key, value] = token.toLowerCase().split('=')
    return [key, value ?? ''] as const
  }))
  const unknown = [...values.keys()].filter(key => !['klu', 'reltol', 'abstol', 'vntol', 'method', 'maxord', 'pivrel'].includes(key))
  if (unknown.length) throw new Error(`Untranslated ngspice options: ${unknown.join(', ')}`)
  const reltol = values.get('reltol') ?? '1e-3'
  const vntol = values.get('vntol') ?? '1e-6'
  const abstol = values.get('abstol') ?? '1e-12'
  const method = values.get('method') ?? 'trap'
  const timeint = [`.options timeint method=${method} reltol=${reltol} abstol=${vntol}`]
  if (values.has('maxord')) timeint.push(`maxord=${values.get('maxord')}`)
  const newton = `reltol=${reltol} abstol=${vntol} rhstol=${abstol} deltaxtol=1`
  return [timeint.join(' '), `.options nonlin ${newton}`, `.options nonlin-tran ${newton}`, ...(values.has('klu') ? ['.options linsol type=klu'] : [])]
}

/**
 * ngspice B-source `pwl(x, x0,y0, ...)` extrapolates its end segments; Xyce has no pwl() and its `table()` holds the
 * end values. They agree exactly only where x stays inside [x0, xN], so every pwl argument must be an explicit
 * `min(max(..., lo), hi)` clamp within the table.
 */
function xyceTables(line: string): string {
  return line.replace(/\bpwl\(min\(max\(([^()]*\([^()]*\)),([^,()]+)\),([^,()]+)\),([^()]*)\)/gi, (_match, argument: string, lo: string, hi: string, table: string) => {
    const xs = table.split(',').filter((_, i) => i % 2 === 0).map(Number)
    if (!(Number(lo) >= xs[0] && Number(hi) <= xs.at(-1)!)) throw new Error(`pwl clamp [${lo}, ${hi}] leaves its table [${xs[0]}, ${xs.at(-1)}]`)
    return `table(min(max(${argument},${lo}),${hi}),${table})`
  }).replace(/\bpwl\(/gi, () => {
    throw new Error(`Unclamped B-source pwl() would extrapolate differently in Xyce: ${line.slice(0, 80)}`)
  })
}

/**
 * Exact sparse replacement for coupled inductors: V_i = L_i dI_i/dt + sum_j (M_ij / L_j) V(L_j), where V(L_j) is
 * the voltage across inductor j's self part. Xyce instead merges every K-connected inductor set into one dense
 * mutual-inductor device.
 */
function mutualChains(scope: Scope, lines: (string | undefined)[]): void {
  const terms = new Map<string, { other: Inductor; henries: number }[]>()
  for (const { first, second, factor } of scope.couplings) {
    const a = scope.inductors.get(first)
    const b = scope.inductors.get(second)
    if (!a || !b) throw new Error(`K references unknown inductor ${first}/${second}`)
    const mutual = factor * Math.sqrt(a.henries * b.henries)
    for (const [self, other] of [[a, b], [b, a]]) terms.set(self.name, [...terms.get(self.name) ?? [], { other, henries: mutual }])
  }
  for (const [name, list] of terms) {
    const inductor = scope.inductors.get(name)!
    const chain = [`${inductor.name} ${inductor.from} xm_${name} ${inductor.henries}`]
    let node = `xm_${name}`
    for (const [i, { other, henries }] of list.entries()) {
      const next = i === list.length - 1 ? inductor.to : `xm_${name}_${i}`
      chain.push(`exm_${name}_${i} ${node} ${next} ${other.from} xm_${other.name} ${Number((henries / other.henries).toPrecision(15))}`)
      node = next
    }
    lines[inductor.line] = chain.join('\n')
  }
}

/** Translate one routed ngspice deck to the equivalent Xyce deck, printing every saved node voltage as CSV. */
export function xyceDeck(deck: string, options: XyceDeckOptions): string {
  const source: string[] = []
  for (const line of deck.split(/\r?\n/)) {
    if (line.startsWith('+') && source.length) source[source.length - 1] += ' ' + line.slice(1)
    else source.push(line)
  }
  const lines: (string | undefined)[] = [source[0]]
  const top: Scope = { inductors: new Map(), couplings: [] }
  const scopes = [top]
  let scope = top
  let saved: string[] = []
  for (const line of source.slice(1)) {
    const tokens = line.trim().split(/\s+/)
    const head = tokens[0].toLowerCase()
    if (head === '' || head.startsWith('*')) lines.push(line)
    else if (head === '.subckt') {
      scope = { inductors: new Map(), couplings: [] }
      scopes.push(scope)
      lines.push(line)
    } else if (head === '.ends') {
      scope = top
      lines.push(line)
    } else if (head === '.options' || head === '.option') lines.push(xyceOptions(line).join('\n'))
    // Xyce .SAVE writes an operating point; node probes become .print. ngspice branch-current saves are dropped.
    else if (head === '.save') {
      saved = tokens.slice(1).filter(vector => /^v\(/i.test(vector))
      lines.push(undefined)
    } else if (head === '.tran') {
      if (tokens.length !== 5 || spiceValue(tokens[3]) !== 0) throw new Error(`Expected .tran step stop 0 maxstep: ${line}`)
      lines.push(line)
    } else if (head === '.end') {
      if (!saved.length) throw new Error('Deck saves no node voltages')
      lines.push(`.print tran format=csv precision=12 file=${options.printFile} ${saved.join(' ')}`, '.end')
    } else if (head.startsWith('.')) throw new Error(`Untranslated control line: ${head}`)
    else if (head.startsWith('b')) lines.push(xyceTables(line))
    else if (head.startsWith('l')) {
      scope.inductors.set(head, { line: lines.length, name: head, from: tokens[1], to: tokens[2], henries: spiceValue(tokens[3]) })
      lines.push(line)
    } else if (head.startsWith('k') && options.mutual === 'vcvs') {
      scope.couplings.push({ first: tokens[1].toLowerCase(), second: tokens[2].toLowerCase(), factor: spiceValue(tokens[3]) })
      lines.push(undefined)
    } else if (/^[rcvefgkx]/.test(head)) lines.push(line)
    else throw new Error(`Untranslated element: ${tokens[0]}`)
  }
  if (options.mutual === 'vcvs') for (const entry of scopes) mutualChains(entry, lines)
  return lines.filter(line => line !== undefined).join('\n').trimEnd() + '\n'
}

/** CLI value after `--name`. */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2)
  const mutual = argument('--mutual') ?? 'vcvs'
  if (!input || !output || (mutual !== 'native' && mutual !== 'vcvs')) throw new Error('Usage: tsx scripts/xyce-deck.ts <in.cir> <out.cir> [--mutual native|vcvs] [--print file.csv]')
  await writeFile(output, xyceDeck(await readFile(input, 'utf8'), { mutual, printFile: argument('--print') ?? 'waveform.csv' }))
}

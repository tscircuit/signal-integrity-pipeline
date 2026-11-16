// IBIS fixture known-answer harness (docs/ibis-fixture-check.md). It compiles one driver with the pipeline's
// own `convertSwitching`, places it alone into every fixture its [Rising/Falling Waveform] tables declare and
// compares ngspice with those tables. Receivers get the DC analogue: the pad current against the clamp tables.
import { cornerValue, interpolate, parseIbis, type IbisBitsStimulus, type IbisCorner, type IbisDocument } from '@tscircuit/ibis-to-spice'
import { convertSwitching } from '../../src/buffers/switching'
import { crossingTime, runGoldenDeck, valueAt } from './golden-checks'

/**
 * Fixed before any run (docs/ibis-fixture-check.md): max |V_sim - V_table| <= 2% of the table swing, and the
 * 50% crossing within max(10 ps, 1% of the table's 20-80% edge time). DC receiver currents: <= 1% of the
 * largest table current over -0.5 V..V_supply + 0.5 V.
 */
export const fixtureTolerance = { swingFraction: .02, crossingSeconds: 10e-12, edgeFraction: .01, currentFraction: .01 } as const

/** The production ngspice options (docs/golden-checks.md); without pivrel=0.1 KLU can run 20x slower. */
const options = '.options klu reltol=1e-4 abstol=1e-12 vntol=1e-7 pivrel=0.1'

/** One buffer at one corner. `weights` swaps the document used to fit switching weights (broken-weighting checks). */
export interface FixtureCase { text: string; component: string; model: string; corner: IbisCorner; weights?: IbisDocument }

/** One replayed fixture: the vendor's table and the metrics measured against it. */
export interface FixtureResult {
  model: string
  corner: IbisCorner
  edge: 'rising' | 'falling'
  fixture: string
  swingVolts: number
  maxErrorFraction: number
  maxErrorSeconds: number
  crossingShiftSeconds: number
  crossingLimitSeconds: number
  pass: boolean
}

/** The first pin whose model or selector admits `model`; reference rails are given explicitly. */
function signalPin(document: IbisDocument, component: string, model: string): string {
  const pin = Object.values(document.components[component].pins).find(entry => entry.model === model || document.selectors[entry.model]?.includes(model))
  if (!pin) throw new Error(`${model}: no ${component} pin uses this model`)
  return pin.name
}

/** Rail voltages at `corner`; this harness supports one supply and ground, with clamps on the same rails. */
function rails(document: IbisDocument, model: string, corner: IbisCorner): number {
  const buffer = document.getBuffer(model)
  /** A reference at `corner`, or its IBIS default. */
  const at = (range: typeof buffer.voltage | undefined, fallback: number): number => range ? cornerValue(range, corner, model) : fallback
  const supply = cornerValue(buffer.voltage, corner, model)
  const pullup = at(buffer.pullupReference, supply)
  if (at(buffer.pulldownReference, 0) !== 0 || at(buffer.groundClampReference, 0) !== 0 || at(buffer.powerClampReference, supply) !== pullup)
    throw new Error(`${model}: fixture harness assumes one supply and ground`)
  return pullup
}

/** Compile `model` at `case.corner` through the pipeline, as an enabled output switching at t = 0, or as an input. */
function compile(input: FixtureCase, edge: 'rising' | 'falling' | 'input', duration: number): { source: string; name: string; nodes: (pad: string) => string } {
  const document = parseIbis(input.text)
  const pin = signalPin(document, input.component, input.model)
  const initialState = edge === 'rising' ? 0 : 1
  const stimuli: Record<string, IbisBitsStimulus> = edge === 'input' ? {} : { sig: { unitInterval: duration * 1e3, startTime: 0, initialState, pattern: { type: 'bits', bits: String(1 - initialState), repeat: false } } }
  const converted = convertSwitching(new TextEncoder().encode(input.text), {
    definition: { source: { content: input.text }, component: input.component, pinMap: { [pin]: 'sig' }, modelSelections: { [pin]: input.model },
      references: { [pin]: { pullup: 'vdd', pulldown: 'gnd', powerClamp: 'vdd', groundClamp: 'gnd' } }, corner: input.corner, packagePolicy: 'omit' },
    run: { duration: duration * 1e3, pinStates: { sig: edge === 'input' ? { mode: 'input' } : { mode: 'output', enabled: true } }, stimuli },
  }, input.weights ?? document)
  const ports = Object.values(converted.spicePinMapping)
  return { source: converted.source, name: /^\.subckt (\S+)/m.exec(converted.source)![1], nodes: pad => ports.map(port => port === 'sig' ? pad : port === 'vdd' ? 'vdd' : '0').join(' ') }
}

/**
 * Replay every declared fixture of both edges in one deck. Package parasitics are excluded: IBIS 7.2 §6.1
 * takes the tables with only R/L/C_dut between die and fixture, and the parser rejects nonzero R/L/C_dut.
 */
export async function replayFixtures(input: FixtureCase): Promise<FixtureResult[]> {
  const document = parseIbis(input.text)
  const buffer = document.getBuffer(input.model)
  const waves = buffer.waveforms.filter(wave => wave.data.every(row => row[{ typical: 1, minimum: 2, maximum: 3 }[input.corner]] !== null))
  if (!waves.length) return []
  const duration = Math.max(...waves.map(wave => wave.data.at(-1)![0]))
  const lines = [`* ${input.model} ${input.corner} fixture replay`, options, `VDD vdd 0 ${rails(document, input.model, input.corner)}`]
  const instances: { edge: 'rising' | 'falling'; fixture: string; table: number[][] }[] = []
  for (const edge of ['rising', 'falling'] as const) {
    const edgeWaves = waves.filter(wave => wave.kind === edge)
    if (!edgeWaves.length) continue
    const compiled = compile(input, edge, duration)
    lines.push(compiled.source)
    for (const wave of edgeWaves) {
      const k = instances.length
      const voltage = cornerValue(wave.fixtureVoltage, input.corner, 'V_fixture')
      lines.push(`X${k} ${compiled.nodes(`pad${k}`)} ${compiled.name}`, `RFIX${k} pad${k} fix${k} ${wave.resistance}`, `VFIX${k} fix${k} 0 ${voltage}`)
      instances.push({ edge, fixture: `${wave.resistance} ohm to ${voltage} V`, table: wave.data.map(([time, ...values]) => [time, cornerValue(values, input.corner, edge)]) })
    }
  }
  lines.push('.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=12', `tran 1p ${duration} 0 1p`, `wrdata golden.dat ${instances.map((_, k) => `v(pad${k})`).join(' ')}`, 'quit', '.endc', '.end')
  const rows = await runGoldenDeck(lines.join('\n') + '\n')
  return instances.map(({ edge, fixture, table }, k) => {
    const first = table[0][1]
    const last = table.at(-1)![1]
    const swing = Math.abs(last - first)
    /** The table voltage at `fraction` of its swing. */
    const level = (fraction: number): number => first + (last - first) * fraction
    const errors = table.map(([time, value]) => Math.abs(valueAt(rows, k + 1, time) - value) / swing)
    const error = Math.max(...errors)
    const shift = crossingTime(rows, k + 1, level(.5)) - crossingTime(table, 1, level(.5))
    const limit = Math.max(fixtureTolerance.crossingSeconds, fixtureTolerance.edgeFraction * (crossingTime(table, 1, level(.8)) - crossingTime(table, 1, level(.2))))
    const pass = error <= fixtureTolerance.swingFraction && Math.abs(shift) <= limit
    return { model: input.model, corner: input.corner, edge, fixture, swingVolts: swing, maxErrorFraction: error, maxErrorSeconds: table[errors.indexOf(error)][0], crossingShiftSeconds: shift, crossingLimitSeconds: limit, pass }
  })
}

/** A receiver's DC pad current over -0.5 V..V_supply + 0.5 V against the sum of its clamp tables (IBIS: current into the pin). */
export async function receiverCurrent(input: FixtureCase): Promise<{ model: string; corner: IbisCorner; maxErrorFraction: number; peakAmps: number; rttOhms: number; pass: boolean }> {
  const document = parseIbis(input.text)
  const buffer = document.getBuffer(input.model)
  const supply = rails(document, input.model, input.corner)
  const compiled = compile(input, 'input', 1e-9)
  /** A clamp table at `corner`; an absent clamp carries no current. */
  const table = (data: typeof buffer.powerClamp): [number, number][] => (data ?? [[-10, 0, 0, 0], [10, 0, 0, 0]]).map(([x, ...values]) => [x, cornerValue(values, input.corner, input.model)])
  const powerClamp = table(buffer.powerClamp)
  const groundClamp = table(buffer.groundClamp)
  const steps = 300
  const overshoot = .5
  const deck = [`* ${input.model} ${input.corner} receiver DC`, options, `VDD vdd 0 ${supply}`, compiled.source, `X0 ${compiled.nodes('pad')} ${compiled.name}`, 'VPAD pad 0 0',
    '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=12', `dc VPAD ${-overshoot} ${supply + overshoot} ${(supply + 2 * overshoot) / steps}`, 'wrdata golden.dat -i(VPAD)', 'quit', '.endc', '.end'].join('\n') + '\n'
  const rows = await runGoldenDeck(deck)
  const expected = rows.map(([voltage]) => interpolate(powerClamp, supply - voltage) + interpolate(groundClamp, voltage))
  const peak = Math.max(...expected.map(Math.abs))
  const error = Math.max(...rows.map((row, i) => Math.abs(row[1] - expected[i]))) / peak
  // DDR3 effective termination (JESD79-3F): RTT = (VIH(ac) - VIL(ac)) / (I(VIH(ac)) - I(VIL(ac))), VREF = V/2 +- 175 mV.
  const high = supply / 2 + .175
  const low = supply / 2 - .175
  const rttOhms = (high - low) / (valueAt(rows, 1, high) - valueAt(rows, 1, low))
  return { model: input.model, corner: input.corner, maxErrorFraction: error, peakAmps: peak, rttOhms, pass: error <= fixtureTolerance.currentFraction }
}

import { parseIbis, type IbisBuffer, type IbisComponent, type IbisDocument } from '@tscircuit/ibis-to-spice'
import type { CircuitJson, SimulationIbisModel } from '../board'
import type { IbisSources } from './types'
import { loadModelSource } from './source'

export interface InspectedPin {
  port: string; pin: string; model: SimulationIbisModel; component: IbisComponent; document: IbisDocument
  buffer: IbisBuffer; text: string; ground: string; power: string
}
/** Selected ideal reference voltages, including the vendor's explicit overrides. */
export function referenceVoltages(buffer: IbisBuffer): Record<'pullup' | 'pulldown' | 'powerClamp' | 'groundClamp', number> {
  const ranges = { pullup: buffer.pullupReference ?? buffer.voltage, pulldown: buffer.pulldownReference ?? [0, 0, 0], powerClamp: buffer.powerClampReference ?? buffer.voltage, groundClamp: buffer.groundClampReference ?? [0, 0, 0] }
  return Object.fromEntries(Object.entries(ranges).map(([role, range]) => {
    const voltage = range[0]
    if (voltage === null || voltage === undefined) throw new Error(`${buffer.name}: missing typical ${role} voltage`)
    return [role, voltage]
  })) as ReturnType<typeof referenceVoltages>
}
/** Parse a numeric IBIS token, including vendor unit suffixes. */
export function ibisNumber(token: string): number {
  const match = /^([+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?)([TGMkmunpf]?)/.exec(token)
  if (!match) throw new Error(`Missing numeric IBIS value: ${token}`)
  const scales: Record<string, number> = { '': 1, T: 1e12, G: 1e9, M: 1e6, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
  return Number(match[1]) * scales[match[2]]
}
/** Resolve a vendor rail by [Pin Mapping], or a unique POWER/GND pin. */
function referenceRail({ model, component, pin, port }: Pick<InspectedPin, 'model' | 'component' | 'pin' | 'port'>, role: 'ground' | 'power'): string {
  const refs = model.ibis_pin_name_to_reference_source_port_ids?.[pin]
  const buses = component.pinMapping[pin]
  let explicit = refs?.pullup_reference_source_port_id ?? refs?.power_clamp_reference_source_port_id
  let bus = buses?.pullup
  let railModel = 'power'
  if (role === 'ground') {
    explicit = refs?.pulldown_reference_source_port_id ?? refs?.ground_clamp_reference_source_port_id
    bus = buses?.pulldown
    railModel = 'gnd'
  }
  if (explicit) return explicit
  const candidates = Object.entries(component.pins).flatMap(([id, candidate]) => {
    if (bus && candidate.signal !== bus) return []
    if (!bus && candidate.model.toLowerCase() !== railModel) return []
    const sourcePortId = model.ibis_pin_name_to_source_port_id[id]
    if (!sourcePortId) return []
    return [sourcePortId]
  })
  if (candidates.length !== 1) throw new Error(`${port}: IBIS ${role} reference is ambiguous; provide the chip's reference mapping`)
  return candidates[0]
}

type SourcePortId = InspectedPin['port']

/** Resolve physical pins and reference rails; ambiguous mappings always fail. */
export function inspectPins(circuit: CircuitJson, sources: IbisSources): Map<SourcePortId, InspectedPin> {
  const pins = new Map<SourcePortId, InspectedPin>()
  for (const model of circuit.filter(r => r.type === 'simulation_ibis_model')) {
    const { text } = loadModelSource({ ...model, pipelineId: model.simulation_ibis_model_id }, sources)
    const document = parseIbis(text)
    const component = document.components[model.ibis_component_name]
    if (!component) throw new Error(`IBIS component ${model.ibis_component_name} is missing`)
    const mapping = model.ibis_pin_name_to_source_port_id
    for (const [pin, port] of Object.entries(mapping)) {
      const physical = component.pins[pin]
      if (!physical) throw new Error(`${port}: physical IBIS pin ${pin} is missing`)
      if (/^(power|gnd|nc)$/i.test(physical.model)) continue
      const choices = document.selectors[physical.model] ?? [physical.model]
      let name = model.ibis_pin_name_to_model_name?.[pin]
      if (name == null && choices.length === 1) name = choices[0]
      if (!name || !choices.includes(name)) throw new Error(`${port}: choose an IBIS model from ${choices.join(', ')}`)
      if (pins.has(port)) throw new Error(`${port}: more than one IBIS pin binding`)
      pins.set(port, { port, pin, model, component, document, buffer: document.getBuffer(name), text, ground: referenceRail({ model, component, pin, port }, 'ground'), power: referenceRail({ model, component, pin, port }, 'power') })
    }
  }
  return pins
}
/** Exact [Model] body, retaining vendor waveform and ramp subsections. */
export function modelText(pin: InspectedPin): string {
  const sections = pin.text.split(/^\s*\[Model\]\s+/gmi).slice(1)
  const section = sections.find(s => s.split(/\s/)[0].toLowerCase() === pin.buffer.name.toLowerCase())
  if (!section) throw new Error(`IBIS model body ${pin.buffer.name} missing`)
  return section
}
/** First interpolated crossing of a measured edge voltage. */
function edgeCrossing(samples: readonly (readonly [number, number])[], target: number): number | undefined {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if ((a[1] - target) * (b[1] - target) <= 0 && a[1] !== b[1]) return a[0] + (target - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
  }
  return undefined
}

/** Fastest measured 10–90% output edge at the typical corner, or the [Ramp] dV/dt. */
export function edgeSeconds(pin: InspectedPin): number {
  const edges: number[] = []
  for (const waveform of pin.buffer.waveforms) {
    const samples = waveform.data.filter(row => row[1] !== null).map(row => [row[0], row[1]!] as const)
    if (samples.length < 2) continue
    const first = samples[0][1]
    const last = samples.at(-1)![1]
    if (Math.abs(last - first) < 1e-6) continue
    const a = edgeCrossing(samples, first + (last - first) * .1)
    const b = edgeCrossing(samples, first + (last - first) * .9)
    if (a !== undefined && b !== undefined && b > a) edges.push(b - a)
  }
  if (!edges.length) {
    for (const line of modelText(pin).split(/\r?\n/).filter(line => /^\s*dV\/dt_[rf]/i.test(line))) {
      const token = line.trim().split(/\s+/)[1]
      if (!token || token === 'NA') continue
      const [dv, dt] = token.split('/')
      const edge = ibisNumber(dt) * .8 * pin.buffer.voltage[0]! / ibisNumber(dv)
      if (edge > 0 && Number.isFinite(edge)) edges.push(edge)
    }
  }
  if (!edges.length) throw new Error(`${pin.port}: IBIS edge rate missing at the typical corner`)
  return Math.min(...edges)
}
/** Selected model capabilities; unsupported types cannot acquire invented receive/disable modes. */
export function pinCapabilities(pin: InspectedPin): { drive: boolean; receive: boolean; disable: boolean } {
  switch (pin.buffer.type) {
    case 'input': return { drive: false, receive: true, disable: false }
    case 'output': return { drive: true, receive: false, disable: false }
    case 'i/o': return { drive: true, receive: true, disable: true }
    case '3-state': return { drive: true, receive: false, disable: true }
    case 'terminator': return { drive: false, receive: true, disable: false }
    default: throw new Error(`${pin.port}: unsupported IBIS model capability ${pin.buffer.type}`)
  }
}

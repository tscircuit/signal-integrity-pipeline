/**
 * Predict what a NanoVNA will measure on the SI coupon (examples/coupon/si-coupon.tsx).
 *
 *   tsx scripts/predict-coupon.tsx [--out examples/coupon/predicted]
 *
 * Each structure runs through the routed pipeline's own stages (RouteSectionsSolver, RouteFieldsSolver and
 * RouteNetworkSolver: actual copper, solved cross-sections, coupled ladder, oblique and via corrections). The
 * transient control lines are replaced by 50 ohm ports and an ngspice AC sweep, one run per driven port:
 * S_jk = 2 V_j / V_source - delta_jk with a 1 V source behind 50 ohm. No IBIS buffers take part.
 * Runs ngspice; on a shared machine wrap it in the heavy-job lock.
 */
import React from 'react'
import { Circuit } from '@tscircuit/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { channelCopperScope, connectedSourceIds, RouteSectionsSolver, type CircuitJson } from '../src/board'
import { RouteFieldsSolver } from '../src/extraction'
import { RouteNetworkSolver, type RoutedBindings, type SimulationPlan } from '../src/simulation'
import { createNativeSolver } from '../src/adapters'
import { SiCoupon, couponStructures, type CouponStructure } from '../examples/coupon/si-coupon'
import { writeTouchstone, type Complex, type Network } from './compare-touchstone'

/** NanoVNA V2 class linear sweep; 15 MHz steps from 50 kHz, so the first point stands in for DC in low-pass TDR. */
export const couponSweep = { startHz: 50e3, stopHz: 3e9, points: 201 } as const
/** Ladder resolution: rise time 1/(10 f_max) at 10 cells per rise keeps every cell below 3.4 ps (lambda/100 at 3 GHz). */
const riseSeconds = 1 / (10 * couponSweep.stopHz)
const portOhms = 50

/** Render the committed TSX; any core error record fails the prediction. */
export async function couponCircuit(): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<SiCoupon />)
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson() as CircuitJson
  const errors = records.filter(record => record.type.endsWith('_error'))
  if (errors.length) throw new Error(JSON.stringify(errors.slice(0, 3)))
  return records
}

/** Source port id of `<connector> > .<label>`. */
function portId(circuit: CircuitJson, component: string, label: string): string {
  const owner = circuit.find(record => record.type === 'source_component' && record.name === component)
  const port = owner?.type === 'source_component' && circuit.find(record => record.type === 'source_port' && record.source_component_id === owner.source_component_id && record.name === label)
  if (!port || port.type !== 'source_port') throw new Error(`Missing ${component}.${label}`)
  return port.source_port_id
}

/** One structure's routed ladder deck without its transient control lines, plus each port's SPICE node. */
export function structureDeck(circuit: CircuitJson, structure: CouponStructure): { lines: string[]; nodes: string[]; warnings: string[] } {
  const signal = structure.ports.map(component => portId(circuit, component, 'SIG'))
  const ground = portId(circuit, structure.ports[0], 'GND')
  const reference = connectedSourceIds(circuit, ground)
  const selected = new Set(signal.flatMap(id => [...connectedSourceIds(circuit, id)]))
  const scope = channelCopperScope(circuit, selected, reference, new Set(), 2)
  const artifactPrefix = `coupon/${structure.name}`
  const sections = new RouteSectionsSolver({ circuitJson: circuit, scope, requiredSourcePortIds: signal, referenceSourcePortId: ground, artifactPrefix })
  sections.solve()
  if (sections.failed) throw new Error(`${structure.name} sections: ${sections.error}`)
  const routed = sections.getOutput().value
  const fields = new RouteFieldsSolver({ geometry: routed.geometry, circuitJson: circuit, scope: routed.scope, maskThicknessMm: routed.maskThicknessMm, artifactPrefix })
  fields.solve()
  if (fields.failed) throw new Error(`${structure.name} fields: ${fields.error}`)
  const nodeMap = Object.fromEntries(circuit.flatMap(record => (record.type === 'source_port' ? [[record.source_port_id, reference.has(record.source_port_id) ? '0' : `p_${record.source_port_id}`]] : [])))
  const plan = { probes: [] } as unknown as SimulationPlan
  const bindings: RoutedBindings = { circuitJson: circuit, scope: routed.scope, mappings: [], plan, nodeMap, groundSourcePortId: ground, electricalLines: [], models: [] }
  const options = { riseSeconds, refinement: 1, durationSeconds: 1e-9, stepSeconds: 1e-12 }
  const network = new RouteNetworkSolver({ blockId: structure.name, name: structure.name, geometry: routed.geometry, extracted: fields.getOutput().value, bindings, materials: fields.materials, options, warnings: [], artifactPrefix })
  network.solve()
  if (network.failed) throw new Error(`${structure.name} network: ${network.error}`)
  const { deck, evidence } = network.getOutput().value
  const lines = deck.trimEnd().split('\n')
  if (!lines.at(-1)!.startsWith('.end') || !lines.at(-2)!.startsWith('.tran') || !lines.at(-3)!.startsWith('.save')) throw new Error('Unexpected routed deck control lines')
  return { lines: lines.slice(0, -3), nodes: signal.map(id => nodeMap[id]), warnings: evidence.warnings as string[] }
}

/** The AC deck that drives port `driven` (0-based) and terminates every other port in 50 ohm. */
export function sweepDeck(lines: string[], nodes: string[], driven: number): string {
  const ports = nodes.flatMap((node, i) => [`VPORT${i} pin${i} 0 DC 0 AC ${i === driven ? 1 : 0}`, `RPORT${i} pin${i} ${node} ${portOhms}`])
  return [...lines, ...ports, '.control', 'set wr_singlescale', 'set wr_vecnames', 'set numdgt=12',
    `ac lin ${couponSweep.points} ${couponSweep.startHz} ${couponSweep.stopHz}`, `wrdata sweep.dat ${nodes.map(node => `v(${node})`).join(' ')}`, 'quit', '.endc', '.end'].join('\n') + '\n'
}

/** Run every port's sweep and assemble the N-port network. */
export async function predictStructure(circuit: CircuitJson, structure: CouponStructure): Promise<{ network: Network; cells: number; warnings: string[] }> {
  const { lines, nodes, warnings } = structureDeck(circuit, structure)
  const run = createNativeSolver({ timeoutMs: 600_000 })
  const count = nodes.length
  const frequenciesHz: number[] = []
  const s: Complex[][][] = []
  for (let driven = 0; driven < count; driven++) {
    const output = await run({ solver: 'ngspice', files: { 'sweep.cir': sweepDeck(lines, nodes, driven) }, args: ['-n', '-b', 'sweep.cir'], outputFiles: ['sweep.dat'] })
    const failure = (output.stdout + '\n' + output.stderr).split(/\r?\n/).find(line => /\b(?:error|fatal|aborted|singular)\b/i.test(line))
    if (failure) throw new Error(`${structure.name} ngspice: ${failure}`)
    const rows = output.files['sweep.dat']!.trim().split('\n').slice(1).map(row => row.trim().split(/\s+/).map(Number))
    if (rows.length !== couponSweep.points) throw new Error(`${structure.name}: ${rows.length} sweep rows`)
    for (const [f, row] of rows.entries()) {
      if (!driven) {
        frequenciesHz.push(row[0])
        s.push(Array.from({ length: count }, () => Array.from({ length: count }, (): Complex => [0, 0])))
      }
      for (let j = 0; j < count; j++) s[f][j][driven] = [2 * row[1 + 2 * j] - (j === driven ? 1 : 0), 2 * row[2 + 2 * j]]
    }
  }
  const cells = lines.filter(line => /^LARCL\d+ /.test(line)).length
  return { network: { ports: count, referenceOhms: portOhms, frequenciesHz, s }, cells, warnings }
}

/** Write one Touchstone prediction per structure. */
async function main(argv: string[]): Promise<void> {
  const out = resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'examples/coupon/predicted')
  await mkdir(out, { recursive: true })
  const circuit = await couponCircuit()
  for (const structure of couponStructures) {
    const started = performance.now()
    const { network, cells } = await predictStructure(circuit, structure)
    const file = join(out, `${structure.name}.s${network.ports}p`)
    await writeFile(file, writeTouchstone(network, [`${structure.name}: ${structure.what}`, `Predicted from examples/coupon/si-coupon.tsx by scripts/predict-coupon.tsx (routed 2.5D ladder, ${cells} series cells, ngspice AC).`,
      'SMA pads enter as parallel-plate C; connector bodies are not modelled, so compare through the FIX2X 2x-thru.', `Port order: ${structure.ports.join(', ')}.`]))
    console.log(`${structure.name}: ${cells} cells, ${((performance.now() - started) / 1000).toFixed(1)} s -> ${file}`)
  }
}

if (process.argv[1]?.endsWith('predict-coupon.tsx')) await main(process.argv.slice(2))

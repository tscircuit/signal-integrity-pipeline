import React from 'react'
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderCoreSignals } from './core-render'
import { OpenemsViaBoard } from '../fixtures/openems-via-board'
import { clipRing, debyeBand, openemsNet } from '../../scripts/openems-net'
import { causalLossResponse } from '../../src/extraction'
import type { CircuitJson } from '../../src/board'

/** Seed (TX pin) and ground source ids of the synthetic via board. */
function ids(circuit: CircuitJson): { seedPortId: string; groundId: string } {
  const tx = circuit.filter(record => record.type === 'source_component').find(record => record.name === 'TX')!
  const port = circuit.filter(record => record.type === 'source_port').find(record => record.source_component_id === tx.source_component_id)!
  const ground = circuit.filter(record => record.type === 'source_net').find(record => record.name === 'GND')!
  return { seedPortId: port.source_port_id, groundId: ground.source_net_id }
}

test('openEMS generator: one microstrip net through one via, from pipeline geometry', async () => {
  const circuit = await renderCoreSignals(<OpenemsViaBoard />)
  const { model, deck } = openemsNet(circuit, ids(circuit))
  const copper = Object.fromEntries(model.copper.map(layer => [layer.name, layer]))
  assert.deepEqual(model.ports.map(port => port.name), ['P1', 'P2'])
  assert.deepEqual([model.ports[0].x, model.ports[1].x], [-20, 20], 'P1 at the TX pad, P2 at the RX pad')
  assert.equal(model.ports[0].zPad, copper.top.zMin, 'top port runs down from the pad face')
  assert.equal(model.ports[0].zPlane, copper.inner1.zMax, 'to the inner1 reference face')
  assert.equal(model.ports[1].zPad, copper.bottom.zMax, 'bottom port runs up from the pad face')
  assert.equal(model.ports[1].zPlane, copper.inner2.zMin, 'to the inner2 reference face')
  const selected = model.traces.filter(trace => trace.selected)
  assert.deepEqual(selected.map(trace => trace.layer).sort(), ['bottom', 'top'])
  assert.ok(selected.every(trace => Math.abs(Math.hypot(trace.b[0] - trace.a[0], trace.b[1] - trace.a[1]) - 20) < 1e-6 && trace.width === .3))
  const signal = model.vias.find(via => Math.hypot(via.x, via.y) < 1e-6)!
  const stitch = model.vias.find(via => Math.hypot(via.x, via.y - 1) < 1e-6)!
  assert.deepEqual([signal.zMin, signal.zMax], [copper.bottom.zMin, copper.top.zMax], 'through barrel spans the stack')
  assert.deepEqual([signal.selected, stitch.selected], [true, false])
  assert.deepEqual(model.antipads.filter(pad => pad.via === signal.id).map(pad => pad.layer).sort(), ['inner1', 'inner2'], 'the signal barrel clears both GND planes')
  assert.ok(model.antipads.every(pad => pad.via !== stitch.id), 'the GND stitch connects to its own planes')
  assert.deepEqual(stitch.padLayers.sort(), ['bottom', 'inner1', 'inner2', 'top'])
  assert.equal(model.pours.length, 2)
  assert.equal(model.pads.length, 2)
  assert.deepEqual(model.markers.map(marker => marker.label.split(' ')[0]), ['top', 'bottom'])
  assert.ok(model.markers[1].roundTripSeconds > 2 * model.markers[0].roundTripSeconds, 'markers sit at each run middle, in route order')
  // The model's region keeps 3 mm around the net, and every band lies inside the stack plus mask.
  assert.deepEqual([model.region.x0, model.region.x1], [-23, 23])
  assert.ok(model.bands.every(band => band.zMin >= model.region.zMin - 1e-9 && band.zMax <= model.region.zMax + 1e-9))
  for (const pattern of [/^\.options klu reltol=1e-4 abstol=1e-12 vntol=1e-7 pivrel=0\.1$/m, /^RS1 S1 P1 50$/m, /^RL2 P2 0 50$/m, /^ac lin 1000 10000000 10000000000$/m, /^LVT0 /m])
    assert.match(deck, pattern)
  const values = [...deck.matchAll(/^[RLC]\S* \S+ \S+ (\S+)$/gm)].map(match => Number(match[1]))
  assert.ok(values.length && values.every(value => value > 0), 'no zero-valued R, L or C: ngspice .ac turns 0 ohm || 0 H stages non-passive')
  const resistance = [...deck.matchAll(/^RARCD\d+ \S+ \S+ (\S+)$/gm)].map(match => Number(match[1]))
  assert.ok(resistance.length && resistance.every(value => value > 0 && value < 1e-6), 'DC resistance is kept only as a numerical anchor')
  assert.match(deck, /^RARCQ\d+ /m, 'the trace-only skin loss retains its DC crossover')
  assert.match(deck, /^RARCS\d+ /m, 'the plane skin loss retains its unshifted remainder after PEC scaling')
})

test('openEMS generator: an open far end leaves one port on both sides', async () => {
  const circuit = await renderCoreSignals(<OpenemsViaBoard />)
  const { model, deck } = openemsNet(circuit, { ...ids(circuit), openFarEnd: true })
  assert.deepEqual(model.ports.map(port => port.name), ['P1'])
  assert.doesNotMatch(deck, /^RL2 /m)
  assert.match(deck, /^wrdata ladder-ac\.txt v\(P1\)$/m)
})

test('openEMS generator: Debye bands reproduce the pipeline dielectric at 1 GHz', () => {
  const band = debyeBand(0, 1, 4.5, .02)
  const omega = 2 * Math.PI * 1e9
  const real = band.epsInf + band.poles.reduce((sum, pole) => sum + pole.delta / (1 + (omega * pole.tau) ** 2), 0)
  const imaginary = band.poles.reduce((sum, pole) => sum + pole.delta * omega * pole.tau / (1 + (omega * pole.tau) ** 2), 0)
  assert.ok(Math.abs(real / 4.5 - 1) < 1e-12, 'Re eps(1 GHz) = er')
  assert.ok(Math.abs(imaginary / real / .02 - causalLossResponse(1e9).dielectricReal / (omega * 1)) < .01, 'loss tangent equals the pipeline fit at 1 GHz')
})

test('openEMS generator: pours are clipped to the model region', () => {
  assert.deepEqual(clipRing([[-10, -10], [10, -10], [10, 10], [-10, 10]], { x0: 0, y0: 0, x1: 5, y1: 5 }).map(point => point.join()).sort(), ['0,0', '0,5', '5,0', '5,5'])
  assert.deepEqual(clipRing([[20, 20], [30, 20], [30, 30]], { x0: 0, y0: 0, x1: 5, y1: 5 }), [])
})

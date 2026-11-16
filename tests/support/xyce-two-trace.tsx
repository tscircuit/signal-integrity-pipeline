import React from 'react'
import { Circuit } from '@tscircuit/core'
import { TwoTraceBoard } from '../../examples/routed/two-trace-board'
import { RoutedPipelineSolver } from '../../src/pipeline'
import type { CircuitJson } from '../../src/board'

// Original synthetic 3.3 V buffer for the Xyce cross-check; no vendor tables. Unlike the drawing-only fixture it has
// package parasitics: with R_pkg = 0 the declared supply, the zero-volt package source and the die rail form an
// ideal voltage-source loop, and ngspice finds no operating point.
const ramp = [[0, 0], [.1, .05], [.2, .25], [.3, .6], [.4, .85], [.5, .97], [.6, 1], [2, 1]]
export const xyceBufferModel = `[IBIS Ver] 4.2
[Component] LVC1G04_DCK
[Manufacturer] Xyce cross-check fixture
[Package]
R_pkg 30m 30m 30m
L_pkg 1.5n 1.5n 1.5n
C_pkg .25p .25p .25p
[Pin] signal_name model_name
2 A LVC1G04_IN_33
3 GND GND
4 Y LVC1G04_OUT_33
5 VCC POWER
[Model] LVC1G04_OUT_33
Model_type Output
Polarity Non-Inverting
C_comp 1.5p 1.5p 1.5p
[Voltage Range] 3.3 3.3 3.3
[Pullup]
-3.3 .08 .08 .08
0 0 0 0
6.6 -.12 -.12 -.12
[Pulldown]
-3.3 -.08 -.08 -.08
0 0 0 0
6.6 .12 .12 .12
[GND_clamp]
-3.3 -.3 -.3 -.3
-.6 0 0 0
3.3 0 0 0
[Ramp]
dV/dt_r 1.98/.3n 1.98/.3n 1.98/.3n
dV/dt_f 1.98/.3n 1.98/.3n 1.98/.3n
R_load = 50
${(['Rising', 'Falling'] as const).flatMap(kind => [0, 3.3].map(fixture => `[${kind} Waveform]\nR_fixture = 50\nV_fixture = ${fixture}\n` +
  ramp.map(([time, fraction]) => {
    const value = fixture / 2 + 1.65 * (kind === 'Rising' ? fraction : 1 - fraction)
    return `${time}n ${value} ${value} ${value}`
  }).join('\n'))).join('\n')}
[Model] LVC1G04_IN_33
Model_type Input
C_comp 2p 2p 2p
[Voltage Range] 3.3 3.3 3.3
[GND_clamp]
-3.3 -.3 -.3 -.3
-.6 0 0 0
3.3 0 0 0
[End]
`

/** The routed deck of the real TwoTraceBoard TSX at 400 Mb/s over 4 ns, compiled without running a simulator. */
export async function xyceTwoTraceDeck(): Promise<string> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true, platformFetch: async () => new Response(xyceBufferModel) } })
  circuit.add(<TwoTraceBoard bit-rate="400Mbps" duration-seconds={4e-9} />)
  await circuit.renderUntilSettled()
  const root = new RoutedPipelineSolver({ circuitJson: circuit.getCircuitJson() as CircuitJson, ibisSources: { 'models/sn74lvc1g04.ibs': xyceBufferModel }, scopeDistanceMm: 1 }, {
    progress: (): void => undefined,
    runSolver: async () => {
      throw new Error('compile only')
    },
  })
  while (!root.getSolver('RouteNetworkSolver')?.solved) await root.stepAsync()
  return root.stageOutput('RouteNetworkSolver').value[0].deck
}

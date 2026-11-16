import React from 'react'
import { simulation } from '@tscircuit/core'

/** Original synthetic 1.5 V push-pull buffer (about 40 Ω, 150 ps edges) and a 1 pF receiver; no vendor tables. */
export const refinementIbis = `[IBIS Ver] 4.2
[Component] FAST15
[Manufacturer] Refinement fixture
[Package]
R_pkg .1 .1 .1
L_pkg 1n 1n 1n
C_pkg .3p .3p .3p
[Pin] signal_name model_name
2 A FAST15_IN
3 GND GND
4 Y FAST15_OUT
5 VCC POWER
[Model] FAST15_OUT
Model_type Output
Polarity Non-Inverting
C_comp 1p 1p 1p
[Voltage Range] 1.5 1.5 1.5
[Pullup]
-1.5 .0375 .0375 .0375
0 0 0 0
3 -.075 -.075 -.075
[Pulldown]
-1.5 -.0375 -.0375 -.0375
0 0 0 0
3 .075 .075 .075
[Ramp]
dV/dt_r .9/.1n .9/.1n .9/.1n
dV/dt_f .9/.1n .9/.1n .9/.1n
R_load = 50
${(['Rising', 'Falling'] as const).flatMap(kind => [0, 1.5].map(fixture =>
    `[${kind} Waveform]\nR_fixture = 50\nV_fixture = ${fixture}\n` + [[0, 0], [.05, 0], [.1, .2], [.15, .5], [.2, .8], [.25, 1], [1, 1], [2, 1]].map(([time, fraction]) => {
      // 40 Ω into the 50 Ω fixture: the swing is 50 / 90 of the supply, centred on the fixture voltage's side.
      const low = fixture * 40 / 90
      const high = low + 1.5 * 50 / 90
      const value = kind === 'Rising' ? low + (high - low) * fraction : high - (high - low) * fraction
      return `${time}n ${value} ${value} ${value}`
    }).join('\n'))).join('\n')}
[Model] FAST15_IN
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 1.5 1.5 1.5
[End]
`

/** Three coupled 40 mm microstrips at 0.3 mm pitch over a solid return: two aggressors around a quiet victim. */
export function RefinementBoard(): React.JSX.Element {
  const patterns = ['01101', '0', '10010']
  return <board width={50} height={12} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed>
    {patterns.map((_, i) => <React.Fragment key={i}>
      {[-20, 20].map(x => {
        const name = `${x < 0 ? 'TX' : 'RX'}${i}`
        const pin = x < 0 ? '4' : '2'
        const label = x < 0 ? 'Y' : 'A'
        const y = i * .3
        const ground = -2.5 - i
        const power = 2.5 + i
        return <React.Fragment key={name}>
          <chip name={name} pcbX={x} pcbY={y} pinLabels={{ pin2: 'A', pin3: 'GND', pin4: 'Y', pin5: 'VCC' }} connections={{ GND: 'net.GND', VCC: 'net.VCC' }} footprint={<footprint>
            <smtpad portHints={[`pin${pin}`]} pcbX={0} pcbY={0} width={.2} height={.2} shape="rect" />
            <smtpad portHints={['pin3']} pcbX={0} pcbY={ground} width={.4} height={.4} shape="rect" />
            <smtpad portHints={['pin5']} pcbX={0} pcbY={power} width={.4} height={.4} shape="rect" />
          </footprint>} />
          <via name={`G_${name}`} pcbX={x} pcbY={y + ground} fromLayer="top" toLayer="bottom" holeDiameter={.15} outerDiameter={.3} connectsTo={`.${name} > .GND`} />
          <simulation.ibismodel componentRef={`.${name}`} ibisModelAsset={{ project_relative_path: 'models/fast15.ibs', url: './models/fast15.ibs', mimetype: 'text/plain' }} ibisComponentName="FAST15"
            ibisPinNameToPortLabel={{ [pin]: label, '3': 'GND', '5': 'VCC' }} ibisPinNameToModelName={{ [pin]: x < 0 ? 'FAST15_OUT' : 'FAST15_IN' }}
            ibisPinNameToReferencePortLabels={{ [pin]: { pullup: 'VCC', pulldown: 'GND', powerClamp: 'VCC', groundClamp: 'GND' } }} />
        </React.Fragment>
      })}
      <trace from={`.TX${i} > .Y`} to={`.RX${i} > .A`} width={.1} pcbPath={[`.TX${i} > .Y`, `.RX${i} > .A`]} />
    </React.Fragment>)}
    <net name="GND" /><net name="VCC" />
    <copperpour name="POWER" connectsTo="net.VCC" layer="top" unbroken outline={[{ x: -24, y: 2.3 }, { x: 24, y: 2.3 }, { x: 24, y: 5.5 }, { x: -24, y: 5.5 }]} />
    <copperpour name="RETURN" connectsTo="net.GND" layer="bottom" unbroken outline={[{ x: -24, y: -5.5 }, { x: 24, y: -5.5 }, { x: 24, y: 5.5 }, { x: -24, y: 5.5 }]} />
    <simulation.pcbtransientchannelsimulation name="REFINE" bitRate="1Gbps" duration={5e-9}>
      {patterns.map((pattern, i) => <simulation.pcbchannel key={i} name={`L${i}`} driverRef={`.TX${i} > .Y`} receiverRef={`.RX${i} > .A`} pattern={pattern} />)}
    </simulation.pcbtransientchannelsimulation>
  </board>
}

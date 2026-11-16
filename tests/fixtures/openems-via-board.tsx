import React from 'react'

/**
 * One 40 mm net (pcbPath points are relative to the TX pad): 20 mm of top microstrip over an inner1 GND plane, one through via at x = 0, then 20 mm of
 * bottom microstrip over an inner2 GND plane. A GND stitch via 1 mm from the signal via carries the return
 * current between the two planes. The receiver is mounted on the bottom side.
 */
export function OpenemsViaBoard({ stitch = true }: { stitch?: boolean } = {}): React.JSX.Element {
  const pad = <footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={.3} height={.3} shape="rect" /></footprint>
  return <board width={64} height={24} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled>
    <chip name="TX" pcbX={-20} pcbY={0} pinLabels={{ pin1: 'P' }} footprint={pad} />
    <chip name="RX" pcbX={20} pcbY={0} layer="bottom" pinLabels={{ pin1: 'P' }} footprint={pad} />
    <trace name="SIG" from=".TX > .P" to=".RX > .P" width={.3}
      pcbPath={['.TX > .P', { x: 20, y: 0 }, { x: 20, y: 0, via: true, fromLayer: 'top', toLayer: 'bottom' }, '.RX > .P']} />
    {stitch && <via name="STITCH" pcbX={0} pcbY={1} fromLayer="top" toLayer="bottom" holeDiameter={.3} outerDiameter={.6} connectsTo="net.GND" />}
    <net name="GND" />
    <copperpour name="TOP_REF" connectsTo="net.GND" layer="inner1" unbroken outline={[{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }]} />
    <copperpour name="BOTTOM_REF" connectsTo="net.GND" layer="inner2" unbroken outline={[{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }]} />
  </board>
}

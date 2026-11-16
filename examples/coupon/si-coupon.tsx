import React from 'react'

// SI measurement coupon: 4-layer 1.6 mm FR-4. fabricatorPreset "jlcpcb_standard" resolves JLC's default 4-layer
// 1.6 mm build, JLC04161H-3313 (L1/L4 1 oz 0.035 mm, 3313 prepreg 0.0994 mm Dk 4.1, NP-155F core 1.265 mm Dk 4.42,
// L2/L3 0.5 oz 0.0152 mm). L2 and L3 are solid GND; every line is a top (or bottom) microstrip over its adjacent plane.
// Dimensions in mm. x runs from the left board edge (-50) to the right edges (-30, 0, 50): a stepped outline puts
// every edge-launch SMA on an edge while each line keeps its own length.

/** 50 ohm top microstrip width over 0.0994 mm 3313 prepreg with 20 um mask (pipeline cross-section: 49.9 ohm). */
export const couponLineWidthMm = 0.152
/** Deliberate low-impedance section of the step line (pipeline cross-section: about 25 ohm). */
export const couponStepWidthMm = 0.5
/** Edge-coupled pair: copper gap between the two 50 ohm lines. */
export const couponPairGapMm = 0.2
const left = -50
const pitch = 12
/** Signal pad of the generic edge-launch SMA: the centre pin lands on it; pads keep JLC's 0.2 mm copper-to-edge clearance. */
const signalPad = { width: 0.4, length: 1.5, edgeGap: 0.25 }

export type CouponStructureName = 'FIX2X' | 'THRU50' | 'STEP' | 'VIA' | 'THRU100' | 'PAIR'
export interface CouponStructure {
  name: CouponStructureName
  /** Touchstone port order: connector refs, port 1 first. */
  ports: string[]
  /** Edge-to-edge length between the two connector reference planes. */
  lengthMm: number
  what: string
}
/** Port order follows the usual 4-port convention: 1 and 2 are one line's ends, 3 and 4 the other's. */
export const couponStructures: CouponStructure[] = [
  { name: 'FIX2X', ports: ['J1', 'J2'], lengthMm: 20, what: '2x thru: two 10 mm launch halves back to back, for de-embedding' },
  { name: 'THRU50', ports: ['J3', 'J4'], lengthMm: 50, what: '50 ohm microstrip thru' },
  { name: 'STEP', ports: ['J5', 'J6'], lengthMm: 50, what: '10 mm at 50 ohm, 30 mm at about 25 ohm (0.5 mm wide), 10 mm at 50 ohm' },
  { name: 'VIA', ports: ['J7', 'J8'], lengthMm: 50, what: 'top 20 mm, via to bottom 10 mm, via back to top 20 mm; GND stitching vias beside each signal via' },
  { name: 'THRU100', ports: ['J9', 'J10'], lengthMm: 100, what: 'the THRU50 line at 100 mm, for length-difference analysis' },
  { name: 'PAIR', ports: ['J11', 'J12', 'J13', 'J14'], lengthMm: 100, what: 'edge-coupled pair, 0.2 mm gap over 78.4 mm; NEXT = S31, FEXT = S41' },
]

/** Generic edge-launch SMA for 1.6 mm boards; `side` -1 sits on a left edge, +1 on a right edge. Check against the bought part's datasheet. */
function EdgeSma({ name, x, y, side }: { name: string; x: number; y: number; side: -1 | 1 }): React.JSX.Element {
  const inward = -side
  return <chip name={name} pcbX={x} pcbY={y} pinLabels={{ pin1: 'SIG', pin2: 'GND' }} connections={{ GND: 'net.GND' }} footprint={<footprint>
    <smtpad portHints={['pin1']} pcbX={inward * (signalPad.edgeGap + signalPad.length / 2)} pcbY={0} width={signalPad.length} height={signalPad.width} shape="rect" />
    {[-1, 1].flatMap(row => ['top', 'bottom'].map(layer => <React.Fragment key={`${row}${layer}`}><smtpad portHints={['pin2']} layer={layer as 'top' | 'bottom'} pcbX={inward * (signalPad.edgeGap + 1.5)} pcbY={row * 2.4} width={3} height={1.2} shape="rect" /></React.Fragment>))}
  </footprint>} />
}

/** A bare 0.15 mm copper junction where two trace widths meet; it lies under the traces and is not a placed part. */
function Junction({ name, x, y }: { name: string; x: number; y: number }): React.JSX.Element {
  return <chip name={name} pcbX={x} pcbY={y} pinLabels={{ pin1: 'J' }} footprint={<footprint><smtpad portHints={['pin1']} pcbX={0} pcbY={0} width={couponLineWidthMm} height={couponLineWidthMm} shape="rect" /></footprint>} />
}

/** Two GND vias per launch side, tying the top and bottom SMA ground pads to L2/L3. */
function LaunchVias({ name, x, y, inward }: { name: string; x: number; y: number; inward: number }): React.JSX.Element {
  return <>{[-1, 1].flatMap(row => [1.2, 2.4].map(depth => <React.Fragment key={`${row}${depth}`}><via name={`GV_${name}_${row > 0 ? 'U' : 'D'}${depth * 10}`} pcbX={x + inward * depth} pcbY={y + row * 2.4} fromLayer="top" toLayer="bottom" holeDiameter={0.3} outerDiameter={0.6} connectsTo="net.GND" /></React.Fragment>))}</>
}

/** Edge-launched straight line from x = left to x = right at height y. */
function Thru({ from, to, y, right }: { from: string; to: string; y: number; right: number }): React.JSX.Element {
  return <>
    <EdgeSma name={from} x={left} y={y} side={-1} />
    <EdgeSma name={to} x={right} y={y} side={1} />
    <LaunchVias name={from} x={left} y={y} inward={1} />
    <LaunchVias name={to} x={right} y={y} inward={-1} />
    <trace from={`.${from} > .SIG`} to={`.${to} > .SIG`} width={couponLineWidthMm} pcbPath={[`.${from} > .SIG`, `.${to} > .SIG`]} />
  </>
}

/** Board outline: right edges at -30 (FIX2X), 0 (THRU50, STEP, VIA) and 50 mm (THRU100, PAIR). */
const outline = [{ x: -50, y: 42 }, { x: -30, y: 42 }, { x: -30, y: 30 }, { x: 0, y: 30 }, { x: 0, y: -6 }, { x: 50, y: -6 }, { x: 50, y: -42 }, { x: -50, y: -42 }]
/** The same staircase inset 0.5 mm, so the L2/L3 GND pours keep their edge clearance. */
const pourOutline = [{ x: -49.5, y: 41.5 }, { x: -30.5, y: 41.5 }, { x: -30.5, y: 29.5 }, { x: -0.5, y: 29.5 }, { x: -0.5, y: -6.5 }, { x: 49.5, y: -6.5 }, { x: 49.5, y: -41.5 }, { x: -49.5, y: -41.5 }]

/** The full coupon; rows 12 mm apart, each line on its own row from the left edge to its right edge. */
export function SiCoupon(): React.JSX.Element {
  const y = (row: number): number => 36 - row * pitch
  // pcbPath points are relative to the first connector's origin (the left board edge, x = left).
  const port = left + signalPad.edgeGap + signalPad.length / 2
  const viaY = y(3)
  const pairTop = y(5)
  const pairBottom = y(6)
  const half = (couponLineWidthMm + couponPairGapMm) / 2
  const jog = (pairTop - pairBottom) / 2 - half
  const straight = 4
  return <board width={100} height={84} layers={4} thickness={1.6} fabricatorPreset="jlcpcb_standard" routeRemaining={false} schematicDisabled isViaInPadAllowed outline={outline}>
    <Thru from="J1" to="J2" y={y(0)} right={-30} />
    <Thru from="J3" to="J4" y={y(1)} right={0} />
    {/* STEP: 10 mm / 30 mm wide / 10 mm between the connector reference planes. */}
    <EdgeSma name="J5" x={left} y={y(2)} side={-1} />
    <EdgeSma name="J6" x={0} y={y(2)} side={1} />
    <LaunchVias name="J5" x={left} y={y(2)} inward={1} />
    <LaunchVias name="J6" x={0} y={y(2)} inward={-1} />
    <Junction name="JS1" x={left + 10} y={y(2)} />
    <Junction name="JS2" x={left + 40} y={y(2)} />
    <trace from=".J5 > .SIG" to=".JS1 > .J" width={couponLineWidthMm} pcbPath={['.J5 > .SIG', '.JS1 > .J']} />
    <trace from=".JS1 > .J" to=".JS2 > .J" width={couponStepWidthMm} pcbPath={['.JS1 > .J', '.JS2 > .J']} />
    <trace from=".JS2 > .J" to=".J6 > .SIG" width={couponLineWidthMm} pcbPath={['.JS2 > .J', '.J6 > .SIG']} />
    {/* VIA: top to bottom at x = -30, back to top at x = -20, with a GND stitching via 1 mm either side of each. */}
    <EdgeSma name="J7" x={left} y={viaY} side={-1} />
    <EdgeSma name="J8" x={0} y={viaY} side={1} />
    <LaunchVias name="J7" x={left} y={viaY} inward={1} />
    <LaunchVias name="J8" x={0} y={viaY} inward={-1} />
    {[-30, -20].flatMap(x => [-1, 1].map(row => <React.Fragment key={`${x}${row}`}><via name={`GV_VIA_${x < -25 ? 'A' : 'B'}${row > 0 ? 'U' : 'D'}`} pcbX={x} pcbY={viaY + row} fromLayer="top" toLayer="bottom" holeDiameter={0.3} outerDiameter={0.6} connectsTo="net.GND" /></React.Fragment>))}
    {/* Plain points either side of each via give the route explicit wire-via-wire copper at the via centre. */}
    <trace from=".J7 > .SIG" to=".J8 > .SIG" width={couponLineWidthMm} pcbPath={['.J7 > .SIG', { x: -30 - left, y: 0 }, { x: -30 - left, y: 0, via: true, fromLayer: 'top', toLayer: 'bottom' }, { x: -30 - left, y: 0 },
      { x: -20 - left, y: 0 }, { x: -20 - left, y: 0, via: true, fromLayer: 'bottom', toLayer: 'top' }, { x: -20 - left, y: 0 }, '.J8 > .SIG']} />
    <Thru from="J9" to="J10" y={y(4)} right={50} />
    {/* PAIR: the 12 mm connector pitch converges at 45 degrees to the 0.2 mm gap; 1 and 2 are the top line. */}
    {([['J11', 'J12', pairTop, 1], ['J13', 'J14', pairBottom, -1]] as const).map(([from, to, row, sign]) => <React.Fragment key={from}>
      <EdgeSma name={from} x={left} y={row} side={-1} />
      <EdgeSma name={to} x={50} y={row} side={1} />
      <LaunchVias name={from} x={left} y={row} inward={1} />
      <LaunchVias name={to} x={50} y={row} inward={-1} />
      <trace from={`.${from} > .SIG`} to={`.${to} > .SIG`} width={couponLineWidthMm} pcbPath={[`.${from} > .SIG`,
        { x: port + straight - left, y: 0 }, { x: port + straight + jog - left, y: -sign * jog }, { x: -port - straight - jog - left, y: -sign * jog }, { x: -port - straight - left, y: 0 }, `.${to} > .SIG`]} />
    </React.Fragment>)}
    <net name="GND" />
    {['inner1', 'inner2'].map(layer => <React.Fragment key={layer}><copperpour name={`GND_${layer}`} connectsTo="net.GND" layer={layer as 'inner1' | 'inner2'} outline={pourOutline} unbroken /></React.Fragment>)}
  </board>
}

export default SiCoupon

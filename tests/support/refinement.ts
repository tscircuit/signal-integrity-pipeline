// Discretisation refinement check (docs/refinement.md). The tolerances were fixed, with their physical
// reasons, before any refined run existed. They are never loosened to make a run pass.

/** A completed transient: shared timestamps and one voltage trace per far-end receiver probe. */
export interface RefinementCapture { timestampsSeconds: number[]; probes: { name: string; voltageLevels: number[] }[] }

/**
 * Predeclared tolerances on the change between a baseline and a refined run.
 * - crossingSeconds 5 ps: under 0.5% of the 1.25 ns CK unit interval and under half the 12.3 ps baseline
 *   max step, so a pass means the 50% crossing does not depend on where the step or the cell boundaries fall.
 * - peakVolts 10 mV: under 0.7% of VDDQ (1.5 V) and about 6% of the 175 mV DDR3 VIH(ac) margin above VREF.
 * - waveformVolts 25 mV: the voltage a 5 ps shift makes on a 5 V/ns edge, the fast end of DDR3 address and
 *   command slew rates; anything larger is a waveform change, not just a timing change.
 */
export const refinementTolerances = { crossingSeconds: 5e-12, peakVolts: 10e-3, waveformVolts: 25e-3 } as const

/** Overshoot, undershoot and 50%-crossing times of one receiver trace, with hysteresis at 20% and 80% of the swing. */
export function edgeMetrics(times: number[], volts: number[], supply: number): { overshoot: number; undershoot: number; crossings: number[] } {
  let state: 'low' | 'high' | undefined
  let crossing = NaN
  const crossings: number[] = []
  for (let i = 0; i < volts.length; i++) {
    if (i > 0 && (volts[i - 1] - supply / 2) * (volts[i] - supply / 2) <= 0 && volts[i - 1] !== volts[i])
      crossing = times[i - 1] + (times[i] - times[i - 1]) * (supply / 2 - volts[i - 1]) / (volts[i] - volts[i - 1])
    const next = volts[i] < .2 * supply ? 'low' : volts[i] > .8 * supply ? 'high' : state
    if (state && next !== state) crossings.push(crossing)
    state = next
  }
  return { overshoot: Math.max(...volts) - supply, undershoot: -Math.min(...volts), crossings }
}

/** Linear interpolation of a trace at `time` over ascending `times`. */
function sample(times: number[], volts: number[], time: number): number {
  let lo = 0
  let hi = times.length - 1
  if (time <= times[0]) return volts[0]
  if (time >= times[hi]) return volts[hi]
  while (hi - lo > 1) {
    const middle = (lo + hi) >> 1
    if (times[middle] <= time) lo = middle
    else hi = middle
  }
  return volts[lo] + (volts[hi] - volts[lo]) * (time - times[lo]) / (times[hi] - times[lo])
}

/** Worst change of each metric over every probe, with the probe that sets it, and pass/fail against the tolerances. */
export interface RefinementComparison {
  crossing: { seconds: number; probe: string }
  overshoot: { volts: number; probe: string }
  undershoot: { volts: number; probe: string }
  waveform: { volts: number; probe: string }
  edgeCountMismatches: string[]
  pass: boolean
}

/** Compare a refined capture with the baseline: |Δ| per metric over all probes; max |Δv| on the union of both time grids. */
export function compareRefinement(baseline: RefinementCapture, refined: RefinementCapture, supply: number): RefinementComparison {
  const result: RefinementComparison = { crossing: { seconds: 0, probe: '' }, overshoot: { volts: 0, probe: '' }, undershoot: { volts: 0, probe: '' }, waveform: { volts: 0, probe: '' }, edgeCountMismatches: [], pass: false }
  const grid = [...new Set([...baseline.timestampsSeconds, ...refined.timestampsSeconds])].sort((a, b) => a - b)
  for (const probe of baseline.probes) {
    const other = refined.probes.find(entry => entry.name === probe.name)
    if (!other) throw new Error(`Refined capture is missing probe ${probe.name}`)
    const a = edgeMetrics(baseline.timestampsSeconds, probe.voltageLevels, supply)
    const b = edgeMetrics(refined.timestampsSeconds, other.voltageLevels, supply)
    if (a.crossings.length !== b.crossings.length) result.edgeCountMismatches.push(probe.name)
    for (let i = 0; i < Math.min(a.crossings.length, b.crossings.length); i++) {
      const delta = Math.abs(a.crossings[i] - b.crossings[i])
      if (delta > result.crossing.seconds) result.crossing = { seconds: delta, probe: probe.name }
    }
    const overshoot = Math.abs(a.overshoot - b.overshoot)
    if (overshoot > result.overshoot.volts) result.overshoot = { volts: overshoot, probe: probe.name }
    const undershoot = Math.abs(a.undershoot - b.undershoot)
    if (undershoot > result.undershoot.volts) result.undershoot = { volts: undershoot, probe: probe.name }
    for (const time of grid) {
      const delta = Math.abs(sample(baseline.timestampsSeconds, probe.voltageLevels, time) - sample(refined.timestampsSeconds, other.voltageLevels, time))
      if (delta > result.waveform.volts) result.waveform = { volts: delta, probe: probe.name }
    }
  }
  const t = refinementTolerances
  result.pass = !result.edgeCountMismatches.length && result.crossing.seconds <= t.crossingSeconds && result.overshoot.volts <= t.peakVolts && result.undershoot.volts <= t.peakVolts && result.waveform.volts <= t.waveformVolts
  return result
}

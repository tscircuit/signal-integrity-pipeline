import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareRefinement, refinementTolerances, type RefinementCapture } from '../tests/support/refinement'

// Compare refined DDR3 captures with a baseline under the predeclared tolerances (docs/refinement.md).
// Usage: bun scripts/check-ddr3-refinement.tsx <baseline dir> <refined dir>...
// Each directory holds a capture.json written by `scripts/run-routed-ddr3.tsx --addr-cmd`. Only aggregate numbers are printed.
const [baselineDirectory, ...refinedDirectories] = process.argv.slice(2)
if (!baselineDirectory || !refinedDirectories.length) throw new Error('Usage: check-ddr3-refinement.tsx <baseline dir> <refined dir>...')
/** DDR3 VDDQ (JESD79-3): the overshoot reference and the 50% crossing level is VDDQ / 2. */
const supply = 1.5
/** Read one run's capture. */
const capture = async (directory: string): Promise<RefinementCapture> => JSON.parse(await readFile(join(directory, 'capture.json'), 'utf8'))
const baseline = await capture(baselineDirectory)
let pass = true
for (const directory of refinedDirectories) {
  const result = compareRefinement(baseline, await capture(directory), supply)
  pass &&= result.pass
  console.log(JSON.stringify({ refined: directory, tolerances: refinementTolerances, crossingPs: result.crossing.seconds * 1e12, crossingProbe: result.crossing.probe, overshootMv: result.overshoot.volts * 1e3, overshootProbe: result.overshoot.probe, undershootMv: result.undershoot.volts * 1e3, undershootProbe: result.undershoot.probe, waveformMv: result.waveform.volts * 1e3, waveformProbe: result.waveform.probe, edgeCountMismatches: result.edgeCountMismatches, pass: result.pass }))
}
process.exitCode = pass ? 0 : 1

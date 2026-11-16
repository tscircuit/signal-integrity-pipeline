# Discretisation refinement check

The full-board DDR3 result should not depend on how finely the pipeline discretises the board. This
is a known-answer check by self-consistency: refine one knob at a time and require the far-end
receiver waveforms to stay within tolerances that were fixed before any refined run existed.

## Knobs

| Knob | Where | Baseline | Refined | Set from outside with |
|---|---|---|---|---|
| Ladder cell length | `src/simulation/route-ladder.ts`: `targetMm` = rise / 10 cells / refinement / delay, then the √(run delay / two rise times) shrink on long runs | refinement 1 | refinement 2 (every cell half as long) | `RoutedProblem.refinement`; `--refinement=2` |
| Transient max step | `src/simulation/routed-control.ts` `.tran step stop 0 step`, the plan's `maxStepSeconds` | the experiment step, min(UI / 100, edge / 20) = 12.31 ps on DDR3_ADDR_CMD | half of it, 6.16 ps | `RoutedProblem.stepSeconds`; `--step-seconds=…` |
| BEM panels per edge | `src/extraction/cross-section-mesh.ts`, through `RouteFieldsSolver` and the oblique-crossing solves | 12 | 18 (1.5×) | `RoutedProblem.panels`; `--panels=18` |

The three overrides are optional fields on `RoutedProblem`. Admission copies them into the block's
compile options, and the pipeline passes the panel count on to `RouteFieldsSolver`. Without them the
deck is unchanged.

## Metrics and tolerances (declared before the runs)

The metrics are measured on every far-end receiver probe. The tolerances apply to the change from the
baseline run, |refined − baseline|. VDDQ is 1.5 V.

| Metric | Definition | Tolerance | Why this size |
|---|---|---|---|
| Edge timing | each 50% (0.75 V) crossing; an edge counts once the trace has gone from below 20% to above 80% of VDDQ, or back | 5 ps | Under 0.5% of the 1.25 ns CK unit interval, and under half of the 12.3 ps baseline max step. A pass means the crossing does not depend on where the time steps or the cell boundaries fall. |
| Overshoot | max v − VDDQ | 10 mV | Under 0.7% of VDDQ and about 6% of the 175 mV DDR3 VIH(ac) margin above VREF. |
| Undershoot | −min v | 10 mV | Same as overshoot, against VIL(ac). |
| Waveform | max \|Δv\| over the whole run, on the union of both time grids | 25 mV | A 5 ps shift on a 5 V/ns edge, the fast end of DDR3 address and command slew, gives 25 mV. A larger difference means the shape changed, not only the timing. |

A different edge count on any probe is also a failure. The tolerances are in
`tests/support/refinement.ts` (`refinementTolerances`). They are never loosened to make a run pass.
A failure is a finding: it names the knob the result depends on, and by how much.

## Runs

All runs use the DDR3_ADDR_CMD block on the private full board: 8 ns, all 24 nets, one ngspice run each,
queued one at a time.

```sh
# Compile only, to check the existing baseline capture matches this commit's deck
bun scripts/run-routed-ddr3.tsx --addr-cmd --compile-only
# Refined runs
bun scripts/run-routed-ddr3.tsx --addr-cmd --refinement=2
bun scripts/run-routed-ddr3.tsx --addr-cmd --step-seconds=6.156942720776704e-12
bun scripts/run-routed-ddr3.tsx --addr-cmd --panels=18
# Compare
bun scripts/check-ddr3-refinement.tsx <baseline dir> <refined dir>...
```

Set `SI_DDR3_BOARD`, `IBIS_MODEL_DIR` and `SI_STAGE_VISUALS_DIR` (an ignored output directory) as for
`scripts/run-routed-ddr3.tsx`. The board, vendor models, decks and captures stay local.

The CI-sized version is `tests/support/refinement.test.tsx`. It runs a committed three-trace TSX board with
an original synthetic IBIS model at baseline and at each refined setting, under the same tolerances. It is
a native check, so it needs `SI_NATIVE_TESTS=1` and `ngspice` on `PATH`.

## Results

Measured on 2026-11-15 at 64aa57d, using bun with ngspice 47 (KLU, `pivrel=0.1`, OMP_NUM_THREADS=1).
Each table cell is the worst |Δ| over all 24 far-end receivers, followed by the net that sets it.
Every run found the same 35 edges, so no probe gained or lost an edge.

| Run | Ladder cells | ngspice | Edge timing (≤ 5 ps) | Overshoot (≤ 10 mV) | Undershoot (≤ 10 mV) | Max \|Δv\| (≤ 25 mV) | Result |
|---|---|---|---|---|---|---|---|
| (a) baseline: refinement 1, 12.31 ps step, 12 panels | 2080 | 1451 s, 5672 points | — | — | — | — | reference |
| (b) half cell length (refinement 2) | 4098 | 3619 s, 5678 points | 0.47 ps (CK) | 0.56 mV (CK) | 0.32 mV (A11) | 1.01 mV (CK) | pass |
| (c) half max step (6.16 ps) | 2080 | 1259 s, 5914 points | 0.019 ps (A8) | 0.05 mV (CK) | 0.21 mV (A6) | 0.40 mV (A5) | pass |
| (d) 1.5× BEM panels (18 per edge), all 24 nets | 2080 | 622 s, 5675 points | 0.20 ps (A5) | 0.12 mV (A7) | 0.17 mV (A5) | 0.75 mV (A5) | pass |

**Verdict: pass.** On this block and at these settings, the full-board DDR3_ADDR_CMD waveforms do not
depend on the discretisation. The largest change is from halving the ladder cell length: 1.0 mV max
|Δv| and 0.47 ps of edge timing, both on CK, the fastest edge at 800 Mb/s. That is 4% of the waveform
tolerance and 9% of the timing tolerance.

Notes on the runs:

- **The old baseline capture was not reused.** The deck regenerated at this commit (`--compile-only`) is
  not byte-identical to the 4da7aad baseline deck. The structure is the same, but 72,311 element values
  differ. The largest relative difference, 1.85%, is in the skin-loss ladder elements (`KARC`, `GARC`,
  `CARC`, `RARC`). The cause was not investigated. Run (a) was therefore re-run at this commit. Its deck is
  byte-identical to the compile-only deck. Compared with the 4da7aad capture under the same tolerances,
  it differs by at most 0.09 mV and 0.011 ps (CKE), so the deck differences have no visible effect.
- **Halving the max step changed little.** It added only 4% more time points, so ngspice's own error
  control, not the 12.3 ps cap, sets most steps.
- **Halving the cells** doubled the cell count (the √ long-run shrink still applies) and multiplied the
  ngspice time by 2.5.
- **18 panels** ran faster in ngspice (622 s against 1451 s), although it has the same 2080 cells and a deck
  of about the same size. This was not investigated. Machine load from other jobs varied during the session.

### CI-sized check

`tests/support/refinement.test.tsx` runs a committed TSX board with an original synthetic IBIS model. The
board has three coupled 40 mm microstrips at 0.3 mm pitch and a quiet victim between two aggressors; the
buffer has 150 ps edges at 1.5 V. It checks the same three refinements under the same tolerances. Measured
on this machine:

| Run | Edge timing | Overshoot | Undershoot | Max \|Δv\| | Result |
|---|---|---|---|---|---|
| half cell length | 0.026 ps | 0.10 mV | 0.10 mV | 0.54 mV | pass |
| half max step | 0.52 ps | 2.85 mV | 2.85 mV | 6.63 mV | pass |
| 1.5× panels | 0.31 ps | 0.51 mV | 0.51 mV | 2.46 mV | pass |

The first fixture had zero package R, L and C. Its per-pin IBIS subcircuits then put ideal rail sources
in parallel loops, and ngspice stopped on a singular matrix. The committed model adds a 0.1 Ω, 1 nH,
0.3 pF package, which removes the loops. The tolerances did not change.

### Not covered

- Only one block (DDR3_ADDR_CMD, 8 ns, PRBS7, Model_352) and one knob at a time were tested; combined
  refinements were not.
- Refinement 2 is one step in the ladder knob, which accepts integers 1 to 4. The test shows the result does
  not change when the cells are halved. It does not give a Richardson error estimate.
- The `cellsPerRise` option and the panel count of the oblique-crossing solves alone were not varied
  separately. `--panels` changes both the main sections and the oblique-crossing solves.
- Self-consistency is not accuracy. Model error that every setting shares, such as the quasi-TEM
  assumption, the IBIS buffers or the stackup, does not show up here.

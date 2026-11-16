# Xyce cross-check of the routed decks

The routed pipeline writes one ngspice deck per block. This check runs the **same deck** in a second,
independent circuit simulator, Sandia's Xyce, and asks whether the node waveforms agree. Agreement
means the results are not an artefact of ngspice's numerics: its time-step control, its Newton
iteration, its KLU settings or its handling of B sources and coupled inductors.

It does not test the physics. Both simulators solve the same equations, so a wrong extraction or a
wrong buffer model gives the same wrong answer in both. The physics checks are in
[golden-checks.md](golden-checks.md).

## Tolerances (fixed before any run)

| Quantity | Tolerance | Applies to |
|---|---|---|
| max \|V_ngspice − V_Xyce\| | ≤ 10 mV | every saved node, over the whole run |
| 50 % crossing times | ≤ 5 ps, and the same number of crossings | every node whose ngspice swing is ≥ 0.2 V |
| End time | both reach the deck's stop time | the run |

How the numbers are measured (`scripts/xyce-cross-check.ts`):

- Each engine keeps its own adaptive time points. ΔV is taken both ways: ngspice samples against
  Xyce's linear interpolant, and Xyce samples against ngspice's.
- The 50 % level is the midpoint of the node's ngspice range. A crossing is counted once per excursion
  beyond ±10 % of the swing (hysteresis), at the last level crossing before the band is left, so
  ripple near the level is not counted.
- Crossings are paired in order.

Why these numbers:

1. **Time-step error.** Both decks ask for reltol = 1e-4 and vntol = 1e-6 V, with Gear (BDF) order ≤ 2.
   Each engine therefore holds its local truncation error near reltol·|V| + vntol ≈ 0.15 mV per step
   on a 1.5 V signal. The estimators and step choices differ, so the errors are not the same. In
   this damped (lossy, terminated) network the global error stays a small multiple of the per-step
   error, not a sum over every step. 10 mV is about 65 times the per-step target and 0.7 % of a 1.5 V
   swing. A difference above it is not step-size noise.
2. **Newton tolerance.** Xyce gets the same reltol, vntol (as its update abstol) and current abstol
   (as its residual tolerance), with deltaxtol = 1. That keeps the Newton error at the same
   ≤ 0.15 mV scale.
3. **Comparison interpolation.** Linear interpolation between time points h apart is off by at most
   h²/8·|V''|. Take a 1.5 V edge with a 100 ps rise, so |V''| ≈ 6e-4 V/ps². At h = 2 ps the error is
   0.3 mV; at h = 5 ps it is 1.9 mV. Both engines use steps near 1 ps on edges.
4. **Translation.** Every rewrite in `scripts/xyce-deck.ts` is an exact identity (table below). It
   adds no error of its own.
5. **Timing.** Δt ≈ ΔV / slope. With ΔV ≤ 10 mV and slopes of at least 2 mV/ps at the 50 % point,
   Δt ≤ 5 ps. Slopes are about 9 mV/ps for a 1.5 V, 100 ps edge.

A failure is a finding. The tolerances are never widened to make a run pass.

## Translation (`scripts/xyce-deck.ts`)

| ngspice construct | Xyce form | Exact? |
|---|---|---|
| Title line, `R C V E F G X`, `.subckt`/`.ends`, `PWL(...)` sources, `.tran step stop 0 maxstep` | unchanged | yes |
| `.options klu reltol abstol vntol method=gear maxord=2 pivrel` | `.options timeint method=gear maxord=2 reltol abstol=vntol`; `.options nonlin` and `nonlin-tran` with `reltol abstol=vntol rhstol=abstol deltaxtol=1`; `.options linsol type=klu` | `pivrel` has no Xyce KLU option and is dropped. Xyce has one weighted update norm, so vntol is its abstol and the ngspice current abstol becomes the residual tolerance. |
| `B… I={…pwl(min(max(x,lo),hi), x0,y0, …)}` | `pwl(` → `table(` | yes, when lo ≥ x0 and hi ≤ xN: Xyce's grammar has no `pwl()`, and `table()` holds its end values where ngspice extrapolates. The translator rejects any pwl whose clamp leaves its table, or any pwl that is not clamped. |
| `.save v(…) i(v.xibis0.…)` | `.print tran format=csv precision=12 v(…)` | Xyce's `.SAVE` writes an operating point. The branch-current saves are dropped. |
| `K… La Lb k` | default (`--mutual vcvs`): the K lines are dropped. Each coupled inductor becomes its self inductor followed by one VCVS per mutual term: V_i = L_i dI_i/dt + Σ_j (M_ij/L_j)·V(L_j). `--mutual native` keeps the K lines. | yes, an algebraic identity. Xyce merges every K-connected inductor set into one mutual-inductor device with a dense n×n stamp (`N_IO_CircuitBlock.C`, `N_DEV_MutIndLin.C`). On the routed ladders that set spans every coupled cell. |

The translator fails on any other control line or element letter, so a new deck construct cannot
pass through untranslated.

## Building Xyce (macOS, Apple Silicon, no sudo)

There is no Homebrew formula and no osx-arm64 Trilinos on conda-forge, so the check builds
Trilinos 16.1.0 and Xyce 7.10.0 from their release tarballs, serially, with Apple clang and Homebrew
dependencies. Fortran and MPI are not used.

```sh
brew install cmake suitesparse openblas fftw flex bison
PREFIX=~/.local/xyce JOBS=6 scripts/xyce-build.sh   # heavy: run it through the shared job lock
```

The build uses Xyce's own `cmake/trilinos/trilinos-base.cmake` preset, with OpenBLAS for
BLAS/LAPACK and AMD from SuiteSparse. Apple clang 21 needs two workarounds, both in the script.
AztecOO calls undeclared C functions, so the build adds `-Wno-error=implicit-function-declaration`.
Xyce's `N_LAS_BlockSystemHelpers.C` calls `std::abs<double>(x)`, which libc++ rejects as ambiguous,
so the script rewrites it to `std::abs(x)`. With `-j6` the whole build took about 10 minutes of wall time on this Mac (87 s + 425 s + 52 s
over three runs, resuming after each fix).

## Running

```sh
# (a) committed CI-sized deck; ngspice and Xyce both run
SI_NATIVE_TESTS=1 XYCE=~/.local/xyce/xyce/bin/Xyce node --import tsx --test tests/tooling/xyce-cross-check.test.ts
# any deck: writes xyce.cir, waveform.csv and report.json into <outdir>
XYCE=~/.local/xyce/xyce/bin/Xyce tsx scripts/xyce-cross-check.ts <simulation.cir> <outdir>
# reuse an existing pipeline capture as the ngspice side
tsx scripts/xyce-cross-check.ts <simulation.cir> <outdir> --capture capture.json --evidence evidence.json
```

## Results

Measured on 2026-11-16 on an Apple Silicon Mac (10 cores, 16 GB), one simulator at a time, single-threaded:
ngspice 47 (Homebrew) and Xyce 7.10.0 serial, built with `scripts/xyce-build.sh`. Decks are compiled
at `feat/si-cosmos-site` 8378539. The tolerances above were committed before any run and are unchanged.

| Run | Deck | Saved nodes | ngspice / Xyce time points | Worst \|ΔV\| | Worst 50 % Δt | Verdict |
|---|---|---|---|---|---|---|
| (a) | `tests/fixtures/two-trace.cir`, 4 ns, VCVS mutuals | 3 | 320 / 406 | 11.4 mV (v(n6), 3.53 V swing) | 3.1 ps | **fail** (ΔV > 10 mV) |
| (a) | same, native K | 3 | 320 / 425 | 12.5 mV | 2.5 ps | **fail** (ΔV > 10 mV) |
| (b) | DDR3_ADDR_CMD, nets A3, A4, A5, 8 ns, 520 cells, 3.3 MB | 3 | 3,296 / 12,883 | 3.1 mV | 0.23 ps | **pass** |
| (c) | DDR3_ADDR_CMD full block, 8 ns (baseline deck and capture) | 24 | see below | | | |

Run time and peak memory for (b): ngspice took 55 s and 103 MiB. Xyce took 1,108 s and 501 MiB.
Xyce took 3.9 times as many time points as ngspice and was 20 times slower.

### Finding (a): both engines carry ~15 mV of time-step error at the deck's settings, and neither is wrong

The 11.4 mV difference was traced to its source before reporting:

1. **Converged reference.** The same deck was rerun in both engines with reltol = 1e-6, vntol = 1e-9 and
   the step ceiling cut from 15.8 ps to 0.2 ps (about 20,000 points each). The two converged runs agree
   to **0.48 µV** and 3.5e-5 ps on every node. The VCVS rewrite of the K lines was used on the Xyce side
   and native K lines on the ngspice side, so the translation is exact as claimed.
2. **Each nominal run against that reference**, at its own time points:

   | Engine (nominal settings) | v(n6) | v(n14) | v(n11) |
   |---|---|---|---|
   | ngspice | 17.0 mV | 16.8 mV | 14.5 mV |
   | Xyce, VCVS mutuals | 16.1 mV | 12.3 mV | 11.2 mV |
   | Xyce, native K | 15.2 mV | 12.6 mV | 11.7 mV |

   Both engines are off by similar amounts, and ngspice is slightly further off. The difference
   between them is the difference between two step-error patterns, not an error in either engine.
3. **Isolation.** With reltol unchanged and only the step ceiling cut to 2 ps, the engines agree to
   0.03 mV (2,030 / 2,028 points). Both then sit 3.4 mV from the reference. The disagreement therefore
   comes from the adaptive steps both engines take up to the deck's 15.8 ps ceiling
   (`.tran step = maxstep = rise / cellsPerRise`). There, reltol = 1e-4 lets each engine take steps
   of 12–16 ps across edges with a 3.5 V swing.

**The predeclared justification was wrong for this deck.** Item 1 assumed steps near 1 ps on
edges, but ngspice averages 12.5 ps here. The tolerance stays at 10 mV, and (a) is recorded as a
fail. The physics finding: at production settings, ngspice waveforms on this deck carry up to about
17 mV (0.5 % of swing) of time-step error. That is below the edge-timing scale (3 ps), but it is
not negligible next to a 10 mV comparison. The DDR3 subset (b) has a 1.75 V swing and uses smaller
steps, and it passes with 3.1 mV.

Xyce native K against Xyce VCVS chains on (a): 2.9 mV apart, which is again only a different step
pattern.

### Finding: the drawing-only TwoTraceBoard fixture deck is singular in ngspice

The routed deck of `tests/support/routed-visual-fixture.tsx` was not used for (a). Its synthetic IBIS
has `R_pkg = L_pkg = C_pkg = 0`, so `VDECLARED0` (3.3 V), the zero-volt package source `VPKG2` and the die
rail `VPDN2` form an ideal voltage-source loop. ngspice stops with "singular matrix: check node
v.xibis2.vpdn2#branch … timestep too small". Replacing the zero-volt `VPKG` sources with 1 mΩ makes it
run. Vendor models have package R, so real decks are unaffected. Any IBIS file whose `[Package]` is
all zero would hit this, though. The fixture used here (`tests/support/xyce-two-trace.tsx`) has
package parasitics instead.

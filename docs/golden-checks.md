# Golden known-answer checks

Each check compares the routed 2.5D pipeline with an answer fixed by exact physics, an
independent reference solve, a hard invariant or the vendor's own data. The expected value and
tolerance sit in the test beside their source. A failing check is never loosened: it is marked
`todo` with its measured value and listed under findings. A "post-hoc" note is an explanation
found after a failure, not a re-fitted check.

Only routed 2.5D modules are exercised: `cross-section`, `causal-loss`, `route-fields-solver`,
`route-energy`/`route-ladder`, `package-model`/`package-matrix`/`coupled-package` and `switching`. The checks
live in the test file of the module they exercise. Shared measuring helpers are in
`tests/support/golden-checks.ts`.

```sh
# Always-on checks (no native tools, no vendor files)
node --import tsx --test --test-concurrency=1 'tests/**/*.test.ts' 'tests/**/*.test.tsx'
# Vendor package checks: local, never-committed IBIS files
IBIS_MODEL_DIR=/path/to/models node --import tsx --test tests/buffers/package-matrix.test.ts tests/buffers/coupled-package.test.tsx
# Native ngspice checks: small decks, one sequential ngspice at a time (OMP_NUM_THREADS=1)
SI_NATIVE_TESTS=1 IBIS_MODEL_DIR=/path/to/models node --import tsx --test tests/simulation/route-ladder.test.tsx tests/buffers/switching.test.tsx
```

Native checks skip without `SI_NATIVE_TESTS=1` or without `ngspice` on `PATH`. Vendor checks
skip without `IBIS_MODEL_DIR` or without the named file (`sprm552c.ibs`, `W631GG6MB-12.ibs`).

## Results

Measured on 2026-11-14 (#27–#29b on 2026-11-17). Cross-sections use b = 1 mm and copper unless stated otherwise.

| # | Check | Reference | Expected / tolerance (fixed in advance) | Measured | Status |
|---|---|---|---|---|---|
| 1 | Coaxial line Z0 = 60/√εr ln(b/a) | — | Not representable: the solver takes rectangles between infinite horizontal planes, so it has no closed outer conductor, no round conductor and no side walls for a square coax. Check 2 (Cohn) is the closest exact shielded geometry. | — | n/a |
| 2 | Stripline C and Z0, w/b = 0.25, 0.5, 1, 2, 4 (t/b = 5e-4, εr 4) | Cohn 1954 exact: Z0 = η0/(4√εr)·K(k)/K(k′), k = sech(πw/2b) | C ≤ 1% at the default 12 panels/edge; C ≤ 0.5% at 24; Z0 ≤ 1% | C error 0.23 / 0.15 / 0.09 / 0.06 / 0.05% at 12; ≤ 0.26% at 24; Z0 ≤ 0.23% | pass |
| 3 | Stripline mesh trend, 6 → 24 panels (t/b = 1e-5) | same | 24-panel error ≤ max(6-panel error, 0.02% floor) | 0.275 → 0.0027% (w/b 0.25); every w/b ≤ 0.0031% at 24 | pass |
| 4 | Parallel-plate trend, w/b = 2, 5, 10 | C_pp = 4εw/(b − t); exact fringe from Cohn | C/C_pp within 1% of Cohn's ratio; decreasing | 1.2208 / 1.0882 / 1.0450 vs 1.2206 / 1.0883 / 1.0441 | pass |
| 5 | Parallel-plate limit, w/b = 20 | same | within 1% of Cohn (1.0221); below w/b = 10; within 3% of C_pp | 1.02213 vs 1.02206 (0.006%), below 1.0442 at w/b = 10 | pass |
| 6 | Homogeneous L·C = μ0ε0εr·I (3-line stripline εr 4; air microstrip pair) | Paul, *MTL* §3.2 | ≤ 1e-9 relative | 1.4e-16, 2.8e-16 | pass |
| 7 | DC resistance R = 1/(σwt) | Ohm's law | R_dc exact to 1e-12; no DC coupling through ideal planes | exact | pass |
| 8 | Replaced by #27 | — | It tested a standalone `hypot(R_dc, R_hf)` interpolation that the ladder never simulated; that code is deleted. | — | n/a |
| 9 | Skin coefficient S equals Wheeler's rule, recomputed in the test (own recession and step) | Wheeler 1942: R = (Rs/μ0)·dL/dn | ≤ 1% | 1.4e-5 (stripline), 4.9e-5 (microstrip pair, full 2×2) | pass |
| 10 | Wide stripline S√f → Rs/w (w = 20, 40 mm) | Ramo, Whinnery & Van Duzer §8.3 | Richardson 2r(40) − r(20) within 2% of 1; r(20) > r(40) > 1; at 12 and at 24 panels | 12 panels: r = 1.0081, 1.0043 (Richardson 1.0005); 24 panels: r = 1.0081, 1.0043 | pass |
| 11 | Stripline high-frequency attenuation α_c = S√f/(2Z0) against Pozar's Wheeler-derived formula (w/b 0.5, 1, 2; t/b 0.035) | Pozar, *Microwave Engineering* 4th ed. §3.7 | within 10% (a curve fit) | solver/Pozar = 0.923 / 0.923 / 0.934 | pass |
| 12 | Causal-loss poles are stable and passive | Guillemin, Foster positive-real form | all poles −rate < 0; all elements > 0; Re Z, Re Y ≥ 0 from 1 Hz to 1 THz | holds | pass |
| 13 | Skin phase X/R = 1 (Zs = (1 + j)Rs), 10 MHz – 5 GHz | Ramo, Whinnery & Van Duzer §5.4 | ≤ 5% | worst 0.8% | pass |
| 14 | Dielectric Kramers–Kronig: dC/d ln ω = −(2/π)·G/ω, 10 MHz – 5 GHz | Djordjevic et al., IEEE T-EMC 2001 | ≤ 5% locally | worst 1.0% | pass |
| 15 | Fixture sections (microstrip, mask, stripline × 1, 2, 12 conductors): L, C0, C SPD, \|k\| < 1; C Maxwell; R(f), G(f) PSD | Paul, *MTL* §3.2–3.4 | floating point only | holds; min λ/λmax 0.297; max k 0.298 | pass |
| 16 | Routed TSX sections (`routedCopper`, `TwoTraceBoard`): same invariants | same | floating point only | holds; max k 0.501 | pass |
| 17 | AM335x package, all 175 pins: L, C SPD, \|k\| < 1, C Maxwell, R PSD | IBIS [Define Package Model]; passivity | λmin > 0, k < 1 | L λmin 1.19 nH (λmax 43.9 nH), k 0.627 (P1/P2); C λmin 0.307 pF, k 0.545; 30,450 raw C off-diagonals positive | pass |
| 18 | AM335x DDR3 selections (24 addr/cmd, 11 DQ write) after `coupledPackage`, plus emitted K | Schur reduction keeps definiteness | λmin > 0, k < 1, K < 1 | addr/cmd: L λmin 1.71 nH, k 0.623 (C2/C1); DQ: L λmin 1.57 nH, k 0.627 | pass |
| 19 | Winbond W631GG6MB-12 package | scalar passivity | no coupled model; every [Pin] R, L, C ≥ 0 | 144 scalars, all ≥ 0 | pass |
| 20 | Ladder conserves Σ L, Σ R, Σ C and K = L12/√(L11L22) | Paul, *MTL* §7.1 | ≤ 1e-9 relative | holds | pass |
| 21 | Matched line: delay l√εr/c and no near-end reflection (100 mm, homogeneous εr 4) | Pozar §2.3 | delay within 1%; near end within 2% of 0.5 V | 665.56 vs 667.13 ps (−0.24%); 0.45 mV | pass |
| 22 | Matched line: far end flat after the edge | same | within 2% of 0.5 V | 5.9 mV (1.2%), 122 cells | pass |
| 23 | Open end and Γs = −½: lattice plateaus and bounce times (k = 0..3) | Johnson & Graham §4.3 (Bergeron) | plateaus within 2% of the 1 V swing; steps within 1% of the ideal time | plateaus ≤ 0.71 mV off; steps within −0.23 / +0.10% | pass |
| 24 | Coupled microstrip pair: even and odd delays from L, C | Paul, *MTL* §5.2 | each within 1% | even +0.05%, odd +0.14% (583 vs 524 ps predicted) | pass |
| 25 | Settled (DC) voltage = divider including R_dc·l (ngspice `.op`) | Ohm's law | ≤ 1e-5 V | 1e-10 V | pass |
| 26 | Vendor buffers into their own IBIS fixtures: AM335x Model_352/345/273/343/336/655/847, Winbond DATA_34/40; typ, min, max; both edges, both 50 Ω fixtures ([ibis-fixture-check.md](ibis-fixture-check.md)) | the vendor [Rising/Falling Waveform] tables | max \|ΔV\| ≤ 2% of swing; \|Δt50\| ≤ max(10 ps, 1% of the 20–80% edge) | 108 replays: typ ≤ 0.60%, min ≤ 0.56%, max ≤ 2.44% of swing; ≤ 1.41 ps. 4 max-corner falling onsets at 2.08–2.44% | todo (4 of 108) |
| 27 | Simulated per-metre R(f) of one trace, 10 MHz – 5 GHz: centred striplines, εr 4.1, 0.1 × 0.0152 mm in b = 0.2152 mm (w/t 6.6) and 0.2 × 0.035 mm in b = 0.5 mm (w/t 5.7), planes as thick as the trace copper | Filament (PEEC) solve of the strip between perfect planes (Weeks et al., *IBM J. Res. Dev.* 23 (1979) 652; exact cell-pair kernel), plus plane loss from the induced surface current with the finite-thickness coth surface impedance | 10% up to 50 MHz, 5% from 100 MHz | 0.1 mm: −4.7% (10 MHz) to +4.4% (200 MHz); 0.2 mm: +1.6% to +4.4% (20 MHz) | pass |
| 27b | Same, wide thin trace 0.3 × 0.0152 mm (w/t 20) | same | same | −11.1% (10 MHz), +5.5% (100 MHz), +6.2% (200 MHz); 1.3–2.9% elsewhere | todo |
| 28 | Ladder attenuation from ngspice AC, α l = Re acosh(V_near/V_far), far end open, 100 mm of the 0.1 × 0.0152 mm stripline, 10 MHz – 5 GHz | α = Re √((R + jωL)·jωC), R and L from the filament solve of #27, C from the field solver (#2–#6) | 10% up to 50 MHz, 5% from 100 MHz | −5.3% (10 MHz) to +4.2% (224 MHz); +2.4% at 5 GHz | pass |
| 29 | Coupled multiport: even and odd modal attenuation of two 0.1 × 0.0152 mm traces, 0.1 mm gap, from ngspice AC (modal α l from the eigenvalues of V_near V_far⁻¹) | 2 × 2 filament solve, modes of (R + jωL)·jωC | same | even −7.8% (10 MHz) to +3.9%; odd −3.0% to +4.7% (224 MHz) | pass |
| 29b | Same, mixed pair: 0.1 × 0.0152 mm beside 0.2 × 0.035 mm (rows with different crossovers) | same | same | −10.7% (mode 0, 10 MHz); every other point −5.1% to +5.8% (47 MHz) and within the band | todo |

## Findings

| Finding | Evidence | Post-hoc reading (not a check) |
|---|---|---|
| Fixed: the 12-panel mesh under-resolved wide conductors | #5 was 4.0% high (C/C_pp 1.0633); #10 had r(40) = 1.85 | Each horizontal conductor face had a fixed panel count, so the middle panel of a 20 mm strip spanned about 6 gaps. A face longer than six plane distances now gets panels in proportion to its length (`cross-section-mesh.ts`). DDR-width faces mesh exactly as before. |
| Fixed: causal-loss quadrature ripple | #13 was 7.2% (phase), #14 was 18.5% (local slope) | One pole per decade from 10 kHz to 1 THz rippled in band. The same nine poles now sit from 10^6.25 to 10^10.5 Hz with nonnegative least-squares weights fitted over 10 MHz–5 GHz (`causal-loss.ts`); every element stays positive, so the network stays passive (#12). Above 10 GHz the skin R is 4% high and rises to 29% at 30 GHz, beyond the ladder's band. |
| Fixed: ladder dispersion on long runs | #22 was 14.3 mV (67 cells) | Lumped-ladder phase error grows with run delay × cell delay², so a fixed 10 cells per rise rings more on longer runs. Runs longer than two rise times now shrink their cells by √(two rise times / run delay) (`route-ladder.ts`). The DDR3 addr/cmd deck grows from 1835 to 2080 cells (+13%). These test decks now use the production `klu pivrel=0.1` options; without them the denser pair deck took 181 s instead of 9 s in KLU refactorisation. |
| Conductor loss: what the network realizes and where it misses | #27–#29b | Per-metre series impedance `R_dc + a(z(s + ω_c) − z(ω_c)) + (S − a) z(s)`: `a` is the trace's own conductor-wall Wheeler share (`stripSkinResistance`), shifted by its own ω_c = π(R_dc/a)², so DC and the trace's skin loss are not counted twice; plane loss and every mutual term have no DC part and keep the plain √f network. `a` is capped at S_ii − Σ|S_ij| so the shared remainder stays diagonally dominant (passive); the deck reports capped cells as `capped_skin_cells`. Remaining errors: the model's planes are half-spaces, so thin planes lose 3–6 points more than the model at 10 MHz (#27b, #29b at 10 MHz); the single-pole-shift crossover shape overshoots by up to 6.2% at 100–200 MHz on a wide thin trace (w/t 20). The reference converges to ≤ 0.5% at 5 GHz (48 × 20 against 80 × 32 cells). No roughness input exists, so no roughness factor is applied. |
| Fixed reference: Pozar gives attenuation, not R | #11 read 0.855–0.886 | Pozar's α_c contains his zero-thickness Z0 (65.4 Ω at w/b 1, against 61.3 Ω for this strip), and the old test converted α_c to R with that Z0, a (Z0 ratio)² ≈ 12% bias. Comparing α_c = R/(2Z0) with each side's own Z0 gives 0.92–0.93. The remaining 7% is inside the fit's declared 10%. |
| Fixed check: the trend floor sat below the thickness bias | #3 plateaued at 0.26% | At t/b = 5e-4 the plateau is the strip's thickness against Cohn's zero-thickness answer (~0.24% for w/b 0.25). The check now uses t/b = 1e-5, where the bias scales to ~0.007%, with a 0.02% floor declared before the run. |
| Vendor AM335x package passes, but its raw C is not Maxwell | #17 | All 30,450 off-diagonals are positive as written. The matrix is SPD and Maxwell only after the repo's documented sign correction. Summed \|mutual L\| per pin is 17–62 nH against 2.1–6.4 nH self, yet L is positive definite with k ≤ 0.627. |
| The IBIS replay is a round trip | #26 | The converter derives its coefficients from these same two tables per edge, so #26 checks the converter and its SPICE realization, not the two-waveform method's accuracy into other loads. The vendor files carry no third, independent fixture; the synthetic closed-form check in [ibis-fixture-check.md](ibis-fixture-check.md) adds one (100 Ω to V_dd/2, ≤ 0.15% of swing). |
| Four max-corner IBIS onsets exceed 2% | #26 | The two fixture tables of an edge have different sparse time grids, and linear interpolation onto one grid makes the weight solve see one fixture start early. Details and follow-up in [ibis-fixture-check.md](ibis-fixture-check.md). |

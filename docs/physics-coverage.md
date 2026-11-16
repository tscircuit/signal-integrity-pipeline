# Physics coverage

The routed pipeline is quasi-TEM 2.5D: boundary-element cross-sections between infinite
reference planes (`extraction/cross-section.ts`), a nine-pole causal Foster loss fit
(`extraction/causal-loss.ts`), lumped π ladders (`simulation/route-ladder.ts`), lumped via
and pad corrections (`simulation/route-transitions.ts`) and IBIS buffers with vendor packages
(`buffers/package.ts`). [Golden checks](golden-checks.md) show the cross-sections and ladders
solve their own model correctly. This page lists what the model leaves out, and how much that
could matter for the DDR3 address/command block.

Status: **modelled** means the effect is in the deck from geometry. **Approximated** means it is in
the deck through a closed-form or assumed value. **Missing** means it is not in the deck at all.

## Reference case for the impact estimates

The estimates below use aggregates from the 8 ns DDR3_ADDR_CMD baseline run at HEAD
(`evidence.json`, private board, never committed):

| Quantity | Value |
|---|---|
| Routes | 24 addr/cmd nets, 39.5–41.8 mm long (median 40.8 mm), 0.1 mm wide, mostly inner-layer stripline |
| Line | median self Z0 59.5 Ω, 6.07 ps/mm, so about 250 ps one-way |
| Loss at 1 GHz, 40 mm | conductor 0.15 dB, dielectric about 0.15 dB (tan δ 0.02 assumed) |
| Vias | 101 signal vias, all blind or buried with zero stub; barrel L 0.21–0.97 nH (median 0.51 nH), C 0.08–0.27 pF |
| Nearest ground via | 0.40–8.2 mm from the signal via (median 1.8 mm) |
| Reference planes | 745 of 4,563 slices reference a power net; 453 slices sit over a plane void and use the edge substitute |
| Neighbours | 162 neighbour port bodies, open or ideal-logic terminated |

Signalling: 400 Mbps, 2.5 ns unit interval, 1.5 V swing. The compiled DDR3 deck uses **246 ps
edges**, the fastest 10–90 % edge of the selected vendor driver (`buffers/inspect.ts:65`). An
earlier draft of this page assumed 0.3–1 ns, and every estimate below has been redone at 246 ps.
The knee frequency 0.35/t_r is 1.4 GHz. Two simple yardsticks recur below:

- A lumped shunt C on a Z0 line reflects about ρ ≈ Z0·C / (2 t_r). For Z0 = 50 Ω and t_r = 246 ps that is 0.10 % per fF, so 10 % per pF.
- A lumped series L reflects about ρ ≈ L / (2 Z0 t_r), so 4.1 % per nH.

(Hall, Hall & McCall, *High-Speed Digital System Design*, §4.4; Bogatin, *Signal and Power Integrity — Simplified*, 3rd ed., §8.11–8.12.)
Values are percent of the incident step and of the 1.5 V swing; 1 % is 15 mV.

## Coverage

| # | Effect | Status | Evidence | DDR3 addr/cmd impact estimate |
|---|---|---|---|---|
| 1 | Via barrel L/C | Approximated | `simulation/route-transitions.ts:29-37` (regularised short-via L, coaxial barrel C), `:74-79`, `:109` (R–L series, C split ½/½) | Median 0.51 nH and 0.16 pF. These partly cancel: Z_via = √(L/C) ≈ 56 Ω, close to the line. If either is 50 % off, the uncancelled part is about 0.25 nH or 0.08 pF, about 1.0 % reflection, 15 mV. **Low.** |
| 2 | Via stubs | Modelled (zero on this board) | `route-transitions.ts:110-117`. The stub is barrel span minus the used span, from `pcb_via.layers` | Every DDR3 via is blind or buried and ends on a used layer, so all 101 stubs are 0 mm. No error on this board. A through via used top→inner1 on a 1.6 mm board would leave a 1.4 mm stub resonating near 25 GHz. That is out of band. |
| 3 | Antipads | Approximated (assumed diameter) | `route-transitions.ts:76`: antipad = pad + 0.20 mm, used only in barrel C; plane voids around barrels are not read from the board | C ∝ 1/ln(antipad/barrel). A 0.2 mm error in the antipad changes the barrel C by about 25 %, which is 0.04 pF or 0.4 % reflection. **Low.** |
| 4 | Reference-plane change at a via, return via | Approximated | `route-transitions.ts:80-107`: nearest spanning GND via. L_ret = 0.2 nH/mm · Δz · ln(1 + 2d/d_hole). With no stitch, it uses 10 mm (`:106`, `:119`) | The median 1.8 mm stitch gives 0–0.49 nH over a 0.1–0.3 mm plane spacing, so 2.0 % at most. The real return path also spreads through the plane cavity, which the formula leaves out. Cavity spreading inductance for a 1.8 mm stitch at 0.3 mm spacing is about 0.1–0.3 nH more (Novak, DesignCon 2005, "Lessons learned from power-plane cavity modelling"), so up to about 1.2 % more reflection. **Low–moderate.** |
| 5 | Return path through a power-net reference (GND→VDD transitions, power-referenced stripline) | Missing (ideal AC ground) | `simulation/route-network.ts:115`, `route-transitions.ts:120`; power pours are ideal references in `board/route-sections.ts:42-51` | 745 slices reference a power net. Where the return jumps planes, its current goes through decoupling capacitors: about 0.5–1 nH of mounted capacitor plus spreading, and the planes' cavity impedance. A 1 nH series return discontinuity gives about 4.1 % reflection (62 mV). It is shared by every line crossing at that point, so it also couples them. **Moderate. The largest single-line omission.** |
| 6 | Gaps, splits and voids under traces | Approximated | `board/route-sections.ts:52-69` (nearest edge within 2 mm, displaced by hypot of vertical and lateral gap) and `:72-88` (exact centre-line cuts) | 453 of 4,563 slices (about 10 %) run over a void with no vertical reference. The substitute keeps a TEM line at a larger height but has no return detour. Crossing a 1 mm split with a 10 mm detour adds about 5–10 nH, a 20–41 % reflection (Bogatin §9.9). That holds only if the void is a true split. A local antipad cluster is much smaller. **Potentially high, unquantified. This is the first openEMS target.** |
| 7 | IBIS package R/L/C | Modelled (AM335x coupled matrix, Winbond [Pin] scalars), one lumped π | `buffers/package.ts:54-85` (scalars), `buffers/coupled-package.ts:46-75` (coupled R/L/C, one π section) | Package flight time √(L·C) ≈ √(4 nH · 1 pF) ≈ 63 ps, against a 246 ps edge. One π section is accurate to about t_r/6 ≈ 41 ps, so the package is undersampled. The error is a smoothing of package ringing above about 2 GHz, roughly 2–3 % of swing. **Low.** |
| 8 | Power-rail and ground noise (SSO) | Missing (ideal die rails) | `buffers/package.ts:8`, `:78` (`VPDN` ideal sources), `:104`; `route-network.ts:115` | 12 of 24 lines switching one way, each about 20 mA into VTT, edge 0.25 ns, so about 1 A/ns. With an effective shared GND/VDDQ path of 0.05–0.1 nH (many balls in parallel), that is 50–100 mV of rail collapse, 3–7 % of swing, plus the matching crosstalk. JEDEC DDR3 budgets about 5 % of VDDQ for SSN. **Moderate. The largest system-level omission.** |
| 9 | Copper roughness | Missing | `route-network.ts:112` (warning); no roughness factor in `extraction/cross-section.ts:79`, `:91-101` | Hammerstad K = 1 + (2/π)·atan(1.4(Rq/δ)²). With δ(1 GHz) = 2.1 µm and Rq = 1–2 µm, K = 1.2–1.6. That adds 0.03–0.09 dB at 1 GHz over 40 mm, about 0.04–0.12 dB at the 1.4 GHz knee, and under 0.02 dB at the 200 MHz fundamental. Under 1.5 % of eye height. **Negligible.** |
| 10 | Frequency-dependent Dk/Df | Approximated (wideband constant-tan δ, assumed tan δ) | `extraction/causal-loss.ts:4-18` (nine Debye/Foster poles, 10 MHz–5 GHz), `simulation/route-ladder.ts:147-151` (Dk referenced at 1 GHz); tan δ 0.02 assumed in `extraction/route-fields-solver.ts:21` | Causality and dispersion are in. The values are not measured: real FR-4 has tan δ 0.015–0.025, which moves dielectric loss by ±0.04 dB at 1 GHz over 40 mm. Dk at 1 GHz off by ±0.1 changes delay by ±1.2 % (±3 ps). **Low.** |
| 11 | Solder mask | Approximated (planar slab) | `extraction/route-lines.ts:27-44`; thickness from the stackup or 0.02 mm assumed, εr 3.3, tan δ 0.025 (`route-fields-solver.ts:21`) | Only outer-layer breakouts see mask, and those are a few mm of each 40 mm route. Planar versus conformal mask moves microstrip Z0 by about 1–2 Ω. **Negligible.** |
| 12 | Non-TEM effects at bends | Missing (bend excess C, current crowding) | `route-network.ts:112` (warning); `simulation/route-ladder.ts:53-70` follows the polyline length only | Excess C of a 90° corner of a 0.1 mm trace is about ε·w²/h ≈ 4 fF, so 0.04 % reflection. Most routing is 45°, which is less. **Negligible.** |
| 13 | Coupling to non-simulated aggressor nets | Approximated (scope cap, pair screen, quiet neighbours) | `board/geometry/scope.ts:24-29`, `:127` (32 mm cap; same or adjacent layers only), `extraction/route-fields-solver.ts:87` (0.5 % pair screen), `route-network.ts:113-116` (neighbour-to-neighbour oblique omitted; 162 neighbour ports open or ideal), `simulation/route-oblique.ts:65` (oblique magnetic term omitted) | Neighbours inside the scope are coupled but quiet. Nets of other blocks (DQ, clock) never switch in this block. Stripline backward crosstalk is k_b = ¼(Cm/C + Lm/L). The strongest retained pair has k ≈ 0.10, so k_b ≈ 5 %: 75 mV per adjacent switching aggressor that the block holds quiet. Stripline forward crosstalk is close to 0. **Moderate where a different-block net runs alongside. Coupling inside the block is modelled.** |
| 14 | Discontinuities at pads and breakouts | Approximated | `route-transitions.ts:39-48`, `:123-137` (parallel-plate pad C), `:142` (fringing and current crowding omitted); `board/route-sections.ts:122` (equipotential lateral joins) | Pad C 4.7 fF–0.42 pF (median 13 fF). Parallel-plate C under-estimates small pads by 20–50 % from fringing, so up to about 0.2 pF on the largest, which is 2.0 % reflection. BGA ball and escape inductance is not in the routed copper. **Low–moderate.** |
| 15 | Plane cavity resonance, radiation, conductor DC drop in planes | Missing | `route-transitions.ts:141` (ideal equipotential planes); `extraction/cross-section-types.ts:44` (planes have zero DC resistance) | The first cavity mode of a board about 50 mm across is about 1.5 GHz/√εr ≈ 0.7 GHz. That is in band, but it is excited only through return-path transitions (rows 4–5). It shows up as row 5's error, not as a separate term. |

### Ranking of what is missing or approximated

1. **Plane voids and splits under the route (row 6).** 10 % of slices, with an unknown detour. Up to tens of percent locally if any is a real split.
2. **Return through power-referenced planes and SSO (rows 5 and 8).** About 4 % and 3–7 % of swing. They interact, and the pipeline has neither.
3. **Different-block aggressors (row 13).** Up to about 5 % backward crosstalk per adjacent switching net.
4. Everything else is at most about 2–3 % of swing (the one-π package, row 7, is the largest).

## Full-wave cross-check against openEMS

### Method (fixed before any openEMS run)

`scripts/openems-net.ts` takes one routed net, plus every scoped neighbour that the pipeline
couples to it, from the pipeline's own board data. That data is `segmentRoutes` wires and pours,
the stackup, the physical `pcb_via` barrels and the port pads. It writes two files for the net:

- **`model.json`** for openEMS. `tools/openems/run_net.py` reads it, builds the CSXCAD geometry and
  runs FDTD.
  - Copper traces, pads and pours are PEC boxes with their real thickness.
  - Vias are solid barrels, with pads on their end layers and on same-net planes.
  - Each plane keeps its actual pour holes. Every other-net plane the barrel crosses also gets at
    least the pipeline's assumed clearance (pad + 0.2 mm).
  - Planes run 10 mm past the model region, through the PML, so the net never sees a plane edge
    that the pipeline's infinite planes do not have.
  - Each port is a 50 Ω lumped port from the reference plane face to the pad face.
- **`ladder.cir`** for ngspice. It is the pipeline's own `routeLadder`, `routeTransitions` and
  `routeOblique` for the same net and scope, with the same 50 Ω ports, run as `.ac` from 10 MHz to
  10 GHz in 10 MHz steps. The ladder cells are sized for a 35 ps rise, about 3.5 ps per cell.

The same post-processing (`tools/openems/compare.py`) turns both S-parameter sets into a TDR
impedance profile, |S21| and delay:

- The TDR uses a 100 ps 10–90 % Gaussian step. The 10 GHz data band limits the step to about
  100 ps, because the Gaussian is down to 5 % at 10 GHz.
- Z0 is read on the TDR at the round-trip time to the middle of each straight run of at least
  8 mm. That time comes from the pipeline's own per-layer delay.
- Delay is the difference between the 50 % crossings of the S21 step response and of the
  incident step.

Like-for-like physics, declared before the run:

- **Conductors are lossless on both sides.** openEMS copper is PEC, because resolving skin depth in
  FDTD is out of reach. In the ladder, skin R is zero and DC R is scaled by 10⁻⁶. It is kept only
  as the multiport's numerical anchor. Conductor loss is covered by golden checks 7–11.
- **The dielectric is lossless on both sides,** with each laminate's stackup εr, the pipeline's
  1 GHz reference value. In the ladder, tan δ = 0 removes the Foster branches, so C is the
  extracted C. openEMS gets the same εr per band, built the same way as `routeCrossSection`'s
  slabs: copper-layer volume takes the nearest laminate, and outer copper and its overcoat take
  mask. The generator can instead emit the pipeline's nine Debye poles per band:
  ε(ω) = ε∞ + Σ Δε_p/(1 + jω/r_p), with Δε_p = εr·tan δ·w_p, the same weights and rates as
  `causalLossPoles()`. openEMS ran at 1.8 MC/s per thread with nine-pole Debye and 18.9 MC/s
  without, so the dispersive comparison is left as a follow-up. Dielectric loss and its causality
  are covered by golden checks 12–14.
- Both sides use the same stackup, mask slab and copper geometry, and the same port pads and
  50 Ω references. Any difference left is then 3D field physics that the 2.5D model leaves out,
  plus the solver error budget below.

### Tolerances (committed before the first openEMS run)

| Quantity | Tolerance | Justification |
|---|---|---|
| Z0 (TDR at the middle of each straight run of 8 mm or more) | ±3 % | Pipeline BEM ≤ 0.3 % (golden checks 2–5). openEMS staircase and mesh error with ≥ 3 cells across the trace width and graded z cells is about 1–2 % (openEMS MSL tutorials; Taflove & Hagness, *Computational Electrodynamics*, 3rd ed., §4.6). TDR smoothing is under 0.5 % on a plateau at least one round-trip rise (8 mm at 6 ps/mm) from its ends. |
| Delay (S21 step, 50 % crossing) | ±2 % | Yee numerical dispersion at ≥ 20 cells per wavelength at 10 GHz is under 0.5 % phase velocity (Taflove & Hagness §4.6). Port reference planes are within one cell, under 0.3 % of a 20 mm route. Both sides use the same dielectric. Ladder phase error is under 0.3 % (golden check 21). |
| \|S21\| (dB), 10 MHz – 3 GHz | ±0.5 dB | Lossless conductors on both sides. Lumped-port parasitics (about 0.1–0.2 nH of vertical port current path) give under 0.1 dB of mismatch ripple at 3 GHz. Microstrip radiation over a short top-layer run is under 0.1 dB below 3 GHz. The rest of the 0.5 dB is margin for mesh error. 3–5 GHz is reported, with no tolerance. |

A failed tolerance is a finding, not a reason to change the tolerance. Each difference is tied
back to a row of the coverage table.

### Results

Measured on 2026-11-16. openEMS is v0.37.0-57-gfc00235 (CSXCAD v0.7.0-9-gfdff4b5), with 8 threads
under the shared heavy-job lock. The ladder side is this branch's pipeline at #89 head 8378539, before
the loss-model change in progress on #87. Its conductor loss (Wheeler skin, nine-pole Foster) is
scaled by 10⁻⁶ in the comparison ladder, so the #87 change does not affect these numbers. Private-board
geometry stays in `.cache/`. Only the aggregates below are published.

**Tooling bug found and fixed first.** The first comparison ladder emitted zero-valued Foster
stages (0 Ω in parallel with 0 H). ngspice `.ac` then gave |S11|² + |S21|² up to 1.5 for a lossless
board, which is not passive. On the coupled DDR3 BA0 deck, the same zeros left the auxiliary
multiport nodes singular, and ngspice spent 13 h in gmin stepping until it was killed. Conductor R
and skin R are now scaled by 10⁻⁶ instead of zeroed. The unit test rejects zero-valued elements, and
`compare.py` reports the passivity of both sides. After the fix the ladder's maximum
|S11|² + |S21|² is 0.997. Every number below uses the fixed ladder.

#### Synthetic via board (TSX, `tests/fixtures/openems-via-board.tsx`)

40 mm of 0.3 mm microstrip: 20 mm on top over inner1, one through via (0.2 mm drill, 0.3 mm pad),
then 20 mm on the bottom over inner2. A GND stitch via sits 1 mm away. The JLC 4-layer stack has a
0.0994 mm prepreg and a 1.265 mm core. The mesh is 0.3/4 mm laterally at 425k cells, and 0.3/8 mm
with the thirds rule and 10 z cells per gap at 657k cells. Each run takes 1.5–8 min.

| Check (tolerance) | Stitch, w/4 mesh | Stitch, w/8 + thirds | No stitch, w/8 + thirds | Verdict |
|---|---|---|---|---|
| Z0, top run middle (±3 %) | 33.06 vs 34.77 Ω, −4.9 % | 33.47 vs 34.77 Ω, −3.8 % | 34.08 vs 34.76 Ω, −2.0 % | fail with the stitch, pass without |
| Z0, bottom run middle (±3 %) | 33.77 vs 35.68 Ω, −5.4 % | 34.12 vs 35.68 Ω, −4.4 % | 37.52 vs 38.44 Ω, −2.4 % | fail with the stitch, pass without |
| Delay (±2 %) | 268.3 vs 286.1 ps, −6.2 % | 267.8 vs 286.1 ps, −6.4 % | 270.4 vs 295.4 ps, −8.5 % | **fail** |
| \|S21\| 0–3 GHz (±0.5 dB) | worst +0.34 dB | worst +0.41 dB | worst −0.58 dB (1.29 GHz) | pass, pass, fail |
| \|S21\| 3–5 GHz (reported) | +0.36 dB | +0.41 dB | +1.24 dB | — |
| TDR peak at the via (openEMS vs ladder) | 39.6 vs 48.0 Ω | 39.9 vs 48.0 Ω | 44.6 vs 56.4 Ω | — |

**Where the delay difference is: the lumped via model (rows 1 and 4).** Ablating the via in the
ladder separates line delay from via delay. These ablations are post-hoc diagnostics, not checks:

| Ladder variant (stitch board) | Ladder delay | openEMS delay | Error |
|---|---|---|---|
| As built: barrel L 1.31 nH + return L 0.53 nH, C 0.52 pF | 286.1 ps | 267.8 ps | −6.4 % |
| Barrel L only (return L removed) | 278.9 ps | 267.8 ps | −4.0 % |
| No via at all | 250.7 ps | 267.8 ps | +6.8 % |

With the stitch, the physical via adds about 17.1 ps (267.8 − 250.7), but the pipeline's lumped
via adds 35.4 ps. Without the stitch, openEMS adds 19.7 ps and the pipeline 44.7 ps, because its
10 mm no-stitch fallback raises the return L to 1.27 nH. The direction is right: removing the
stitch makes the via slower and more inductive on both sides (openEMS +2.6 ps, TDR peak +4.7 Ω).
The size is about 2× too large on delay, and the inductive TDR peak is 8–12 Ω too high. In row-1
terms, √(LC) = √(1.84 nH · 0.52 pF) = 31 ps of lumped delay sits where the full-wave via shows
about 17 ps. The L in the TI short-via formula and the return-loop L both overestimate a 1.5 mm
through via whose stitch is 1 mm away.

**Line Z0 (mesh and TDR resolution, not a coverage row).** The line markers are 6–10 mm from a port or the via, which is
within one TDR rise (8 mm), so they carry some contamination. The same top run reads 33.47 Ω with
the stitch and 34.08 Ω without it, at the same mesh, 1.8 % apart. Refining the mesh moved
openEMS +1.2 % toward the pipeline. The remaining −2 to −4 % is within mesh plus contamination
uncertainty, so it is **not** attributed to missing physics. Pipeline Z0 for this microstrip is
not contradicted.

openEMS's own passivity check gives a maximum |S11|² + |S21|² of 1.014 at 10 MHz, so its port
normalisation carries about 0.7 % amplitude error at the bottom of the band.


#### Real DDR3 nets: setup (fixed before any real-net FDTD run)

The whole-net models do not fit the machine. Including neighbours within 1 mm, BA1 needs 62M
cells even at 2 cells across the 0.1 mm trace, and A12 is similar. That is about 10 h of FDTD per
net. Two findings from the board shaped the windowed setup that replaces them:

- **Every DDR3 via is a via-in-pad at a BGA ball.** 18 of 24 nets have exactly two vias, at arc
  length 0 and at the far end. The other 6 have none. There is no plane under such a pad: the
  barrel fills it and the antipad clears the plane. A 50 Ω lumped port there would float, so the
  BGA end is left **open on both sides**. The comparison is a one-port TDR from a cut in the route.
- **The "voids" on the selected nets are the antipads of those same vias.** From the baseline
  evidence, 6 of the 24 nets run over a void, for 0.65–0.80 mm per net with a lateral gap of at most
  0.35 mm. Each void is the trace leaving its via-in-pad over the next plane's clearance. None is a
  split or slot.

Each window is the last 8 mm of route plus the U3-end via-in-pad and the open pad. The U1 port and
its pad move to the cut, over a solid plane. The scope is 0.1 mm, so neighbour nets are almost
entirely left out on both sides. The tolerances do not change. Z0 has no marker, because no
straight run in the window reaches 8 mm. The delay check uses the open-end reflection: the one-way
delay is half the time the TDR takes to reach ρ = +0.5, measured against the incident step.

| Window | What it contains | Mesh |
|---|---|---|
| A12, last 8 mm | bottom-layer microstrip, its exit over the inner6 antipad (the void), and a through via to the U3 top pad | 9.8M cells, 0.033 mm |
| BA1, last 8 mm | inner2 stripline (each of its 15 slices has a power-net reference), and a blind via up to the U3 top pad | 4.1M cells, 0.025 mm |

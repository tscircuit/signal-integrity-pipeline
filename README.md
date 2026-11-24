## What is it?

Native signal-integrity simulation for tscircuit boards. Describe each test with
`<simulation.pcbtransientchannelsimulation>` and `<simulation.pcbdriverreceiverchannel>`. `RoutedPipelineSolver` consumes the
resulting Circuit JSON, solves quasi-TEM 2D cross-sections along the actual routed copper (2.5D), assembles
coupled ladders with the IBIS buffers, and runs one transient per channel simulation in ngspice.
This draft implements the pipeline entry of [RFC #28](https://github.com/tscircuit/rfc/pull/28).

## How to use it?

```tsx
import { simulation } from "@tscircuit/core"

<board fabricatorPreset="jlcpcb_standard">
  {/* Place the routed endpoints and their simulation.ibismodel declarations here. */}
  <simulation.pcbtransientchannelsimulation name="DATA_TEST" bitRate="20Mbps">
    <simulation.pcbdriverreceiverchannel name="DATA" driverRef=".TX > .Y" receiverRef=".RX > .A" />
  </simulation.pcbtransientchannelsimulation>
  <simulation.eyediagram name="DATA_EYE" simulationRef="DATA_TEST" />
</board>
```

```ts
import { RoutedPipelineSolver } from '@tscircuit/signal-integrity-pipeline'
import { createNativeSolver, loadIbisSources } from '@tscircuit/signal-integrity-pipeline/node'

const solver = new RoutedPipelineSolver({
  input: { circuitJson, ibisSources: await loadIbisSources({ circuitJson, baseDir: '.' }) },
  context: { runSolver: createNativeSolver(), progress: console.log },
})
await solver.solveAsync()
const { channelSimulations, files } = solver.getOutput()
```

Circuit JSON is the electrical input. `ibisSources` and the `{ runSolver, progress }`
context are IO ports. Circuit JSON durations and channel offsets are in milliseconds.
Captured solver timestamps are in seconds. Each entry in `channelSimulations` holds its compiled ngspice deck,
evidence and completed probe capture.
Captures are candidate evidence without independent convergence qualification.
`files` maps every artifact path to its bytes; writing them is the caller's choice.
A board with no channel simulations completes after planning without invoking a solver.

Branched routes remain unsupported. Inline IBIS coupled package matrices are
validated before the deck is built and lowered to a passive lumped package. Unlisted
pins follow the IBIS [Pin]/[Package] hierarchy and merged rail bus rules;
missing or invalid matrix definitions still fail.
Die POWER/GND references always connect directly to perfect rails;
vendor package R/L/C remains between every mapped pin and its die node.

The TSX examples use the pinned `@tscircuit/core` preview. Place transient
simulations and eye diagrams directly under the board, including when it
contains cached subcircuits. Core checks endpoint connectivity and routing,
supplies preset via plating, and plans omitted pseudo-random binary sequence (PRBS) seeds by channel name.
The pipeline reads the IBIS assets and validates the selected model capabilities.
Aggressors are output-capable pins retained by the copper scope that do not
drive a declared channel in the simulation. This includes bidirectional
receivers. Declare their state on the simulation. Use `aggressorPattern="0"`
or `"1"` for a quiet level, or use a channel pattern such as `"clock"` or
`"prbs7"` to switch at the simulation bit rate from time zero.
`aggressorDisabled` takes precedence and requires every aggressor
model to support high impedance. The selected channels (victims) keep their
own `pattern` and `driverDisabled` settings. TSX authors need a core build that
emits the aggressor fields.

ngspice must already be installed; `createNativeSolver({ tools: { ngspice } })`
accepts an executable path. No package install or solver download happens during
a solve. Native processes are serialized and run with `OMP_NUM_THREADS=1`.
Vendor IBIS files and board JSON remain local and ignored by git.

## General workflow

```mermaid
flowchart TD
  board[/"Your board<br/>(Circuit JSON with transient channel simulations)"/] --> s1["1. Admit each channel simulation: drivers, receivers, the copper scope and declared aggressor states<br/><small>pipeline</small>"]
  chips[/"Chip models<br/>(IBIS files; coupled package admission)"/] --> s1
  s1 --> manifest["Transient channel simulation plan manifest"]
  s1 --> s2["2. Cut the scoped copper into straight sections over their reference planes<br/><small>board</small>"]
  s2 --> s3["3. Calculate each unique cross-section's coupled RLGC matrices<br/><small>rlgc</small>"]
  chips --> s4
  s3 --> s4["4. Bind IBIS buffers, probes, sources and passives to physical ports<br/><small>buffers, simulation</small>"]
  s4 --> s5["5. Assemble delay-bounded coupled ladders with via and oblique corrections into one deck<br/><small>simulation</small>"]
  s5 --> s6["6. Run one transient per channel simulation and admit only complete probe vectors<br/><small>simulation</small>"]
  s6 <-->|"RunSolver"| ng{{"ngspice"}}
  s6 --> out[/"Captures + deck and evidence artifacts"/]
  s1 -->|"no channel simulations"| out
```

The pipeline is inspectable with solver-utils. All six stage rows exist before the
first step; each stage processes all planned channel simulations in order, with no nested channel simulation
pipelines.

<!-- routed-stages:start -->
| # | Stage solver |
|---|---|
| 1 | TransientChannelSimulationPlanSolver |
| 2 | CopperGeometryExtractionSolver |
| 3 | TransmissionLineRlgcSolver |
| 4 | RouteBindingsSolver |
| 5 | RouteNetworkSolver |
| 6 | RouteTransientSolver |

```mermaid
flowchart LR
  s0["TransientChannelSimulationPlanSolver<br/>Plan one transient channel simulation per step"]
  s1["CopperGeometryExtractionSolver<br/>All planned channel simulations, one item per step"]
  s2["TransmissionLineRlgcSolver<br/>All planned channel simulations, one item per step"]
  s3["RouteBindingsSolver<br/>All planned channel simulations, one item per step"]
  s4["RouteNetworkSolver<br/>All planned channel simulations, one item per step"]
  s5["RouteTransientSolver<br/>All planned channel simulations, one item per step"]
  s0 --> s1
  s1 --> s2
  s2 --> s3
  s3 --> s4
  s4 --> s5
  s5 <-->|"await RunSolver"| engine["local native ngspice"]
```

```mermaid
stateDiagram-v2
  [*] --> TransientChannelSimulationPlanSolver
  TransientChannelSimulationPlanSolver --> CopperGeometryExtractionSolver: all channel simulations completed
  CopperGeometryExtractionSolver --> TransmissionLineRlgcSolver: all channel simulations completed
  TransmissionLineRlgcSolver --> RouteBindingsSolver: all channel simulations completed
  RouteBindingsSolver --> RouteNetworkSolver: all channel simulations completed
  RouteNetworkSolver --> RouteTransientSolver: all channel simulations completed
  RouteTransientSolver --> [*]
  TransientChannelSimulationPlanSolver --> failed: invalid channel simulation input, including undeclared aggressors
  CopperGeometryExtractionSolver --> failed
  TransmissionLineRlgcSolver --> failed
  RouteBindingsSolver --> failed
  RouteNetworkSolver --> failed
  RouteTransientSolver --> failed
  failed --> [*]
```
<!-- routed-stages:end -->

Missing electrical facts fail explicitly. Numerical settings come from selected
IBIS edge rates, bit rates, stackup and actual routes. Every channel simulation produces an
independent run. A differential endpoint drives opposite physical levels and
measures P minus N. Quiet channels remain connected and are probed at the far
receiver and at the near quiet driver. Single-ended probes always use their chip's
local ground. Numeric offsets are seconds. Automatic duration ends when the
last channel or switching aggressor completes one full pattern at its
declared bit rate after its offset.
Clock uses two unit intervals, a switching literal uses its bit count, and
PRBS7 uses 127 unit intervals. Quiet channels use one unit interval from time
zero. A default clock-only or short-literal capture shows the time trace. Set
`duration` for a longer recording or to run PRBS15 or PRBS31. Explicit durations
are used as supplied.
IBIS values always use the typical corner.

### 2D RLGC calculation

The 2D resistance, inductance, conductance and capacitance (RLGC) calculation takes rectangular conductors, reference planes and dielectric layers.
It returns per-unit-length capacitance, inductance, DC resistance, and coefficients for dielectric and skin loss.

```mermaid
flowchart LR
  crossSection["Cross-section geometry"] --> panels["Plan and build boundary panels"]
  panels --> fields["Calculate electrostatic fields and loss coefficients"]
  fields --> matrices["Check reciprocity and passivity"]
  matrices --> coefficients["Per-unit-length matrices"]
```

```mermaid
stateDiagram-v2
  [*] --> CrossSectionReady
  CrossSectionReady --> Meshed: valid geometry and panel budget
  CrossSectionReady --> CalculationFailed: invalid geometry, options or panel budget
  Meshed --> CoefficientsReady: finite, reciprocal and passive matrices
  Meshed --> CalculationFailed: singular, nonfinite, nonreciprocal or nonpassive matrices
  CoefficientsReady --> [*]
  CalculationFailed --> [*]
```

## Development validation

Install dependencies with `bun install --frozen-lockfile`, then run `bun test`.
Optional checks use `test.skipIf` and known failures still execute through `test.failing`.
Run `bun run test:package` to verify the packed package in Node and Bun.

SVG visual baselines in `tests/**/__snapshots__/` use the `.snap.svg` suffix so GitHub displays image previews.
The visual-test helper compares their contents byte for byte.

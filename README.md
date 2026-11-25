## What is it?

Signal-integrity tools for tscircuit boards.

## How to use it?

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
`TransientChannelSimulationPlanSolver` reads PCB transient channel simulation records written by core from TSX. It checks
channel endpoints, IBIS models, timing and patterns, including pseudo-random binary sequences (PRBS).
Each declared channel simulation becomes immutable inputs for copper geometry extraction and buffer binding.
`CopperGeometryExtractionSolver` models scoped traces, vias, reference pours, and pad contacts. It groups wires into sections with consistent nearby copper and reference surfaces.
`TransmissionLineRlgcSolver` screens nearby wire pairs for coupling and calculates per-unit-length RLGC matrices for each coupled group.
IBIS conversion resolves scalar or coupled package elements and validates selected package matrices during planning.
RouteBindingsSolver associates compiled buffers, sources and probes with the allocated circuit node map.
RouteNetworkSolver integrates route energies into a coupled ladder with via and oblique corrections and emits a deck.
RouteTransientSolver invokes ngspice through the injected solver port and publishes complete raw-vector captures.

Aggressors are output-capable pins retained by the copper scope that do not
drive a declared channel in the simulation. This includes bidirectional
receivers. Declare their state on the simulation. Use `aggressorPattern="0"`
or `"1"` for a quiet level, or use a channel pattern such as `"clock"` or
`"prbs7"` to switch at the simulation bit rate from time zero.
`aggressorDisabled` takes precedence and requires every aggressor
model to support high impedance. The selected channels keep their own
`pattern` and `driverDisabled` settings. The pinned core version emits the
aggressor fields.

Automatic duration covers a full pattern for every switching channel or
aggressor, measured at its declared bit rate after its offset.

## General workflow

```mermaid
flowchart LR
  input["RouteNetworkSolver"] --> result["RouteTransientSolver"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: RouteTransientSolver
  Ready --> Failed: invalid input
  Complete --> [*]
  Failed --> [*]
```

```mermaid
flowchart LR
  board["Circuit JSON and channel declarations"] --> plan["TransientChannelSimulationPlanSolver"]
  ibis["IBIS sources"] --> packages["Validate IBIS package matrices"]
  packages --> plan
  plan --> geometry["CopperGeometryExtractionSolver"]
  geometry --> transmissionLineRlgc["TransmissionLineRlgcSolver"]
  plan --> binding["IBIS binding inputs"]
  binding --> spice["Convert packages and switching coefficients to SPICE"]
  plan --> manifest["Transient channel simulation plan manifest"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Planned: TransientChannelSimulationPlanSolver
  Planned --> GeometryReady: CopperGeometryExtractionSolver
  GeometryReady --> Complete: TransmissionLineRlgcSolver
  GeometryReady --> Failed: invalid cross-section geometry or material options
  Planned --> Failed: missing required contact or reference, unsupported route or soldermask
  Ready --> Failed: invalid input, conflicting IBIS model selections, invalid package matrices or undeclared aggressors
  Complete --> [*]
  Failed --> [*]
```

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
Run `bun run fetch:vendor-models` and put `ngspice` on PATH before running the IBIS tests locally.

Run `bun run test:package` to verify the packed package in Node.

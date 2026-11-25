# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing, pseudo-random binary sequence (PRBS) patterns and declared aggressor states.
TransientChannelSimulationPlanSolver lowers each declared channel simulation into immutable inputs for copper geometry extraction and buffer binding.
Ideal wires, named nets and internal pin ties form the source groups used by SPICE.
A named net can span the extracted traces connecting its own contacts, including multipoint ideal junctions.
Channel planning and binding use the same receiver graph. Its paths traverse ideal junctions, extracted traces and series passives.
Rail shunts and differential terminations stay outside those paths, including terminations attached by both copper and ideal wires.
Each extracted trace keeps both physical contacts. Binding checks their selected models and detects signal contacts tied to ground.
Removing an extracted trace or series passive from the receiver graph must disconnect its two ends.
An alternate path reports the physical contacts and distinguishes an entirely routed loop from a bypass through ideal wiring.
`CopperGeometryExtractionSolver` models scoped traces, vias, reference pours, and pad contacts. It groups wires into sections with consistent nearby copper and reference surfaces.
`TransmissionLineRlgcSolver` screens nearby wire pairs for coupling and calculates per-unit-length RLGC matrices for each coupled group.
Planning validates the package matrices for the mapped pins and records any capacitance sign conversion and the source SHA-256. Binding calls `compileBuffers` to convert each validated model through `@tscircuit/ibis-to-spice` and retain its assembly evidence. The package converter accepts scalar `[Pin]` and `[Package]` values and local lumped `[Define Package Model]` matrices with pipe comments. External `.pkg` lookup and distributed package sections are unsupported.

The package uses one branch for each merged rail pin group. Multiple board pins in a group must already share a board node. Rail branches with zero DC resistance use the board bias. The die clamp biases a rail behind nonzero series resistance. Scalar shunt capacitance uses the buffer’s pulldown reference, and a coupled package with separate ground banks uses circuit ground for its shared matrix reference.
RouteBindingsSolver associates compiled buffers, sources and probes with the allocated circuit node map.

```mermaid
flowchart LR
  input["Validated IBIS models and ports"] --> result["RouteBindingsSolver"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: RouteBindingsSolver
  Ready --> Failed: invalid input
  Complete --> [*]
  Failed --> [*]
```

```mermaid
flowchart LR
  board["Circuit JSON and channel declarations"] --> prepare["Prepare channel and aggressor states"]
  ibis["IBIS sources"] --> packages["Validate IBIS package matrices"]
  packages --> prepare
  prepare --> traces["Identify extracted trace contacts"]
  traces --> groups["Group ideal source contacts"]
  groups --> paths["Map ordered driver-to-receiver paths"]
  traces --> geometry["CopperGeometryExtractionSolver"]
  geometry --> transmissionLineRlgc["TransmissionLineRlgcSolver"]
  paths --> bindings["Binding inputs"]
  bindings --> spice["Convert packages and switching coefficients to SPICE"]
  bindings --> checks["Check contacts and alternate paths around each segment"]
  paths --> manifest["Transient channel simulation plan manifest"]
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

## 2D RLGC calculation

The internal `calculateRlgc` function in `src/rlgc/` calculates the per-unit-length matrices in input conductor order.
Capacitance (with dielectrics and in vacuum) is in F/m, external inductance is in H/m and DC resistance is in Ω/m.
For frequency `f` in Hz, multiply the dielectric loss coefficient (F/m) by `2πf` for conductance in S/m.
Multiply the skin resistance coefficient (Ω/m/√Hz) by `√f` for the high-frequency skin contribution in Ω/m.
The calculation also returns the conductor-only skin coefficient, obtained with fixed reference planes.

Interfaces in a half-space extend by the requested number of cross-section spans. Between two reference planes, padding is measured in the lateral field decay length (plane spacing divided by π). Each shielded region is limited to 3072 boundary panels before dense matrix allocation.

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

The native adapter waits for the executable to exit. The legacy caller-specified timeout and its dedicated diagnostic were removed. IBIS source validation continues to check paths and reject non-IBIS data. The previous byte-size limit was removed.

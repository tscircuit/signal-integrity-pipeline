# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing, pseudo-random binary sequence (PRBS) patterns and declared aggressor states.
TransientChannelSimulationPlanSolver lowers each declared channel simulation into immutable inputs for route sections and buffer binding.
Ideal wires, named nets and internal pin ties form the source groups used by SPICE.
A named net can span the extracted traces connecting its own contacts, including multipoint ideal junctions.
Channel planning and binding use the same receiver graph. Its paths traverse ideal junctions, extracted traces and series passives.
Rail shunts and differential terminations stay outside those paths, including terminations attached by both copper and ideal wires.
Each extracted trace keeps both physical contacts. Binding checks their selected models and detects signal contacts tied to ground.
Removing an extracted trace or series passive from the receiver graph must disconnect its two ends.
An alternate path reports the physical contacts and distinguishes an entirely routed loop from a bypass through ideal wiring.

```mermaid
flowchart LR
  board["Circuit JSON and channel declarations"] --> prepare["Prepare channel and aggressor states"]
  ibis["IBIS sources"] --> prepare
  prepare --> traces["Identify extracted trace contacts"]
  traces --> groups["Group ideal source contacts"]
  groups --> paths["Map ordered driver-to-receiver paths"]
  traces --> sections["Route sectioning inputs"]
  paths --> bindings["Binding inputs"]
  bindings --> checks["Check contacts and alternate paths around each segment"]
  paths --> manifest["Transient channel simulation plan manifest"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: TransientChannelSimulationPlanSolver
  Ready --> Failed: invalid input or undeclared aggressors
  Complete --> [*]
  Failed --> [*]
```

The native adapter waits for the executable to exit. The legacy caller-specified timeout and its dedicated diagnostic were removed. IBIS source validation continues to check paths and reject non-IBIS data. The previous byte-size limit was removed.

# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing and pseudo-random binary sequence (PRBS) patterns.
RoutedAdmissionSolver lowers each declared block into immutable inputs for route sections and buffer binding.
RouteSectionsSolver divides scoped copper into straight slices and resolves physical endpoint contacts.
The standalone 2D cross-section solve returns per-unit-length C/C0/L and frequency-dependent R/G.
RouteFieldsSolver screens nearby conductor pairs and extracts coupled coefficients for each unique section.
IBIS conversion resolves scalar or coupled package elements and validates selected package matrices during admission.
RouteBindingsSolver associates compiled buffers, sources and probes with the allocated circuit node map.
RouteNetworkSolver integrates route energies into a coupled ladder with via and oblique corrections and emits a deck.
RouteTransientSolver invokes ngspice through the injected solver port and publishes complete raw-vector captures.

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

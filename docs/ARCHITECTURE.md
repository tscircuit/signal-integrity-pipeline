# Signal-integrity pipeline architecture

The stack retains Circuit JSON validation, physical stackup and stimulus helpers, IBIS asset loading and the ngspice adapter.
Declare transient channels in Circuit JSON. Signal preparation validates endpoint topology, selected IBIS capabilities,
timing and pseudo-random binary sequence (PRBS) patterns.

```mermaid
flowchart LR
  input["Channel declarations"] --> result["Signal checks and pin selection"]
```

```mermaid
stateDiagram-v2
  [*] --> Ready
  Ready --> Complete: Signal checks and pin selection
  Ready --> Failed: invalid input
  Complete --> [*]
  Failed --> [*]
```

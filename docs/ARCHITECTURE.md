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
Planning validates the package matrices for the mapped pins and records any capacitance sign conversion and the source SHA-256. Binding converts the buffers and package to SPICE. The package converter accepts scalar `[Pin]` and `[Package]` values and local lumped `[Define Package Model]` matrices with pipe comments. External `.pkg` lookup and distributed package sections are unsupported.

The package uses one branch for each merged rail pin group. Multiple board pins in a group must already share a board node. Rail branches with zero DC resistance use the board bias. The die clamp biases a rail behind nonzero series resistance. Scalar shunt capacitance uses the buffer’s pulldown reference, and a coupled package with separate ground banks uses circuit ground for its shared matrix reference.

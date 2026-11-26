// Every code in src/simulation/diagnostics.ts raised with today's code AND message (module rule M3).
// MESSAGES are the pre-module implementation's messages, recorded on 2026-11-07 while the old flat src/
// still existed and this test compared old and new raisers directly.
import { test } from "bun:test"
import assert from "node:assert/strict"
import { Diagnostic } from "../../src/kernel/index.js"
import * as current from "../../src/simulation/index.js"
import {
  fixture,
  fixtureGeometry as geometryFromCircuitJson,
} from "./fixtures.mjs"

const impls = {
  current: { ...current, geometry: geometryFromCircuitJson },
}
const one = (cj, type, pred = () => true) =>
  cj.find((e) => e.type === type && pred(e))
const declare =
  ({ mutate = () => {}, m = undefined } = {}) =>
  (impl) => {
    const { cj, m: base, controls } = fixture()
    const modeling = m ? m(base) : base
    const out = mutate(cj, controls.run) ?? cj
    const { receiverPaths } = impl.geometry(out, modeling)
    return impl.generalDeclarations({
      circuit: out,
      receiverPaths,
      modeling,
      controls,
    })
  }
const electrical =
  ({ mutate, m = (base) => base }) =>
  (impl) => {
    const { cj, m: base } = fixture()
    mutate?.(cj)
    const modeling = m(base)
    const g = impl.geometry(cj, modeling)
    const nodes = impl.circuitNodes({
      circuit: cj,
      receiverPaths: g.receiverPaths,
      modeling,
    })
    return impl.electricalSources({ circuit: cj, modeling, nodes })
  }
const square = (extra) => (cj) => {
  cj.push({
    type: "simulation_voltage_source",
    simulation_voltage_source_id: "sq",
    is_dc_source: false,
    terminal1_source_port_id: "v0",
    terminal2_source_port_id: "g0",
    voltage: 3.3,
    frequency: 1e6,
    wave_shape: "square",
    ...extra,
  })
}

const MESSAGES = {
  simulation_reference:
    "simulation_reference: Duplicate simulation_voltage_probe identifier diff",
  simulation_experiment:
    "simulation_experiment: A transient experiment with spiceEngine=pcb_spice is required",
  simulation_capability:
    "simulation_capability: This PCB backend supports unswept transient experiments only",
  simulation_timing:
    "simulation_timing: run time_per_step: finite positive milliseconds required",
  simulation_scope:
    "simulation_scope: data: no models in its explicit subcircuit scope",
  simulation_probe:
    "simulation_probe: data: at least one voltage probe required",
  native_declaration: "native_declaration: bad ibisModel",
  ibis_model: "ibis_model: At least one serialized native IBIS model required",
  ibis_mapping:
    "ibis_mapping: TX: physical pin mapping points outside its chip",
  ibis_state: "ibis_state: data: duplicate run state for p0",
  channel_model: `channel_model: data DQSn: endpoint p3 requires ${"exactly one modeled physical pin and an explicit run state"}`,
  stimulus_duplicate:
    "stimulus_duplicate: data: multiple stimuli drive the same physical output",
  stimulus_state:
    "stimulus_state: stimulus1: stimulus requires an enabled IBIS output in this experiment",
  stimulus_missing:
    "stimulus_missing: data: enabled output requires one explicit digital stimulus",
  stimulus_pattern:
    "stimulus_pattern: A nonempty binary string or array of numeric 0/1 bits is required",
  stimulus_coverage:
    "stimulus_coverage: stimulus0: nonrepeating bits do not cover the complete run",
  probe_reference: "probe_reference: diff: unknown signal/reference source",
  channel_short:
    "channel_short: Extracted endpoints are shorted by another ideal source trace or reference",
  electrical_input:
    "electrical_input: declared supply: explicit finite value required",
  supply_reference: `supply_reference: Voltage sources require explicit ${"positive and negative source port/net terminals"}`,
  supply_short:
    "supply_short: Explicit supply terminals resolve to the same node",
  supply_missing: `supply_missing: Declare physical voltage sources or explicit source-port supplies; ${"this backend never invents VDD"}`,
  source_edge:
    "source_edge: Square voltage sources require explicit positive rise/fall times",
  source_capability:
    "source_capability: Voltage waveform sinewave is unsupported by this PCB backend",
  passive_reference:
    "passive_reference: Selected passive component is missing or ambiguous",
  passive_capability: "passive_capability: TX: expected two physical ports",
  ibis_contract:
    "ibis_contract: Converter did not emit a SPICE component wrapper",
}

for (const [code, run] of [
  [
    "simulation_reference",
    declare({
      mutate: (cj) => {
        cj.push({ ...one(cj, "simulation_voltage_probe") })
      },
    }),
  ],
  [
    "simulation_experiment",
    declare({
      mutate: (cj) => {
        one(cj, "simulation_experiment").spice_engine = "ngspice"
      },
    }),
  ],
  [
    "simulation_capability",
    declare({
      mutate: (cj) => {
        one(cj, "simulation_experiment").experiment_type =
          "spice_dc_operating_point"
      },
    }),
  ],
  [
    "simulation_timing",
    declare({
      mutate: (cj) => {
        one(cj, "simulation_experiment").time_per_step = 0
      },
    }),
  ],
  [
    "simulation_scope",
    declare({
      mutate: (cj) => {
        one(cj, "simulation_experiment").subcircuit_id = "unrelated"
      },
    }),
  ],
  [
    "simulation_probe",
    declare({
      mutate: (cj) => cj.filter((e) => e.type !== "simulation_voltage_probe"),
    }),
  ],
  [
    "native_declaration",
    declare({
      mutate: (cj) => {
        cj.push({
          type: "source_invalid_component_property_error",
          property_name: "ibisModel",
          message: "bad ibisModel",
        })
      },
    }),
  ],
  [
    "ibis_model",
    declare({
      mutate: (cj) => cj.filter((e) => e.type !== "simulation_ibis_model"),
    }),
  ],
  [
    "ibis_mapping",
    declare({
      mutate: (cj) => {
        one(cj, "simulation_ibis_model").ibis_pin_name_to_source_port_id["9"] =
          "p2"
      },
    }),
  ],
  [
    "ibis_state",
    declare({
      mutate: (_, run) => {
        run.states.push({ ...run.states[0] })
      },
    }),
  ],
  [
    "channel_model",
    declare({
      mutate: (_, run) => {
        run.states = run.states.filter((state) => state.source_port_id !== "p3")
      },
    }),
  ],
  [
    "stimulus_duplicate",
    declare({
      mutate: (_, run) => {
        run.stimuli.push({ ...run.stimuli[0] })
      },
    }),
  ],
  [
    "stimulus_state",
    declare({
      mutate: (_, run) => {
        run.stimuli[1].source_port_id = "p2"
      },
    }),
  ],
  [
    "stimulus_missing",
    declare({
      mutate: (_, run) => {
        run.stimuli.pop()
      },
    }),
  ],
  [
    "stimulus_pattern",
    declare({
      mutate: (_, run) => {
        run.stimuli[0].transmission_pattern.bits = "012"
      },
    }),
  ],
  [
    "stimulus_coverage",
    declare({
      mutate: (_, run) => {
        run.stimuli[0].transmission_pattern = {
          transmission_type: "bits",
          bits: "001",
          repeat: false,
        }
      },
    }),
  ],
  [
    "probe_reference",
    declare({
      mutate: (cj) => {
        one(cj, "simulation_voltage_probe").signal_input_source_port_id =
          "missing"
      },
    }),
  ],
  [
    "channel_short",
    declare({
      mutate: (cj) => {
        cj.push({
          type: "source_trace",
          source_trace_id: "short",
          connected_source_port_ids: ["p0", "p2"],
        })
      },
    }),
  ],
  [
    "electrical_input",
    electrical({
      mutate: undefined,
      m: (m) => ({ ...m, supplies: [{ ...m.supplies[0], voltageV: NaN }] }),
    }),
  ],
  [
    "supply_reference",
    electrical({
      mutate: (cj) => {
        cj.push({
          type: "simulation_voltage_source",
          simulation_voltage_source_id: "dc",
          is_dc_source: true,
          voltage: 1,
          positive_source_port_id: "v0",
        })
      },
    }),
  ],
  [
    "supply_short",
    electrical({
      m: (m) => ({
        ...m,
        supplies: [{ ...m.supplies[0], positive: { sourcePortId: "g0" } }],
      }),
    }),
  ],
  [
    "supply_missing",
    electrical({ mutate: undefined, m: (m) => ({ ...m, supplies: [] }) }),
  ],
  ["source_edge", electrical({ mutate: square({}) })],
  [
    "source_capability",
    electrical({ mutate: square({ wave_shape: "sinewave" }) }),
  ],
  [
    "passive_reference",
    electrical({
      m: (m) => ({
        ...m,
        passiveComponents: [{ sourceComponentId: "missing" }],
      }),
    }),
  ],
  [
    "passive_capability",
    electrical({
      mutate: undefined,
      m: (m) => ({ ...m, passiveComponents: [{ sourceComponentId: "u0" }] }),
    }),
  ],
  [
    "ibis_contract",
    (impl) => impl.namespaceSpice({ source: "* no wrapper\n", prefix: "I0" }),
  ],
]) {
  test(`reports ${code}`, () => {
    assert.ok(Object.hasOwn(MESSAGES, code), code)
    assert.throws(
      () => run(impls.current),
      (e) => {
        assert.ok(e instanceof Diagnostic, code)
        assert.equal(e.domain, "simulation")
        assert.deepEqual(
          { code: e.code, message: e.message },
          { code, message: MESSAGES[code] },
        )
        return true
      },
      code,
    )
  })
}

const { circuitNodes, electricalSources } = current
// CPU and RAM each connect to a local DQ net. Net-only traces join both to the board's DQ net.
function splitChannelNet(circuit) {
  for (const [id, scope] of [
    ["dq-cpu", "cpu"],
    ["dq-ram", "ram"],
    ["dq-board", "board"],
  ]) {
    circuit.push({
      type: "source_net",
      source_net_id: id,
      name: "DQ",
      subcircuit_id: scope,
      member_source_group_ids: [],
    })
  }
  const traces = [
    ["bind-cpu", ["p0"], ["dq-cpu"]],
    ["bind-ram", ["p2"], ["dq-ram"]],
    ["join-cpu", [], ["dq-cpu", "dq-board"]],
    ["join-ram", [], ["dq-board", "dq-ram"]],
  ]
  for (const [id, ports, nets] of traces) {
    circuit.push({
      type: "source_trace",
      source_trace_id: id,
      connected_source_port_ids: ports,
      connected_source_net_ids: nets,
    })
  }
}

test("a channel net split into subcircuits is cut like one shared net", () => {
  const { cj, m, g } = fixture()
  splitChannelNet(cj)
  const nodes = circuitNodes({
    circuit: cj,
    receiverPaths: g.receiverPaths,
    modeling: m,
  })
  assert.notEqual(nodes.node("p0"), nodes.node("p2"))
  assert.throws(() => nodes.node("dq-board"), /channel_net/)
  const { cj: fanoutCircuit, m: fanoutModeling, g: fanoutGeometry } = fixture()
  splitChannelNet(fanoutCircuit)
  fanoutCircuit.push({
    type: "source_trace",
    source_trace_id: "tap",
    connected_source_port_ids: ["p1"],
    connected_source_net_ids: ["dq-board"],
  })
  const input = {
    circuit: fanoutCircuit,
    receiverPaths: fanoutGeometry.receiverPaths,
    modeling: fanoutModeling,
  }
  assert.throws(() => circuitNodes(input), /channel_fanout/)
})

test("orphan ideal sources fail preflight", () => {
  const { cj, m, g } = fixture()
  cj.push(
    {
      type: "source_component",
      source_component_id: "voltage",
      name: "ORPHAN",
    },
    {
      type: "source_port",
      source_port_id: "vspos",
      source_component_id: "voltage",
    },
    {
      type: "source_port",
      source_port_id: "vsneg",
      source_component_id: "voltage",
    },
    {
      type: "simulation_voltage_source",
      simulation_voltage_source_id: "voltage-source",
      terminal1_source_port_id: "vspos",
      terminal2_source_port_id: "vsneg",
      voltage: 3.3,
      is_dc_source: false,
    },
  )
  const nodes = circuitNodes({
    circuit: cj,
    receiverPaths: g.receiverPaths,
    modeling: m,
  })
  assert.throws(
    () => electricalSources({ circuit: cj, modeling: m, nodes }),
    /floating_source.*ORPHAN/,
  )
})

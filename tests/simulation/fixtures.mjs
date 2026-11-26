// The straight two-lane board with explicit experiment records and hand-written lane mappings.
import { readFile } from "node:fs/promises"
export const fixtureGeometry = () => ({
  receiverPaths: [
    ["p0", "p2"],
    ["p1", "p3"],
  ].map(([from, to], index) => ({
    channelName: ["DQS", "DQSn"][index],
    sourceTraceId: `s${index}`,
    fromSourcePortId: from,
    toSourcePortId: to,
  })),
})
const geometryFromCircuitJson = fixtureGeometry
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"))
export const circuit = await read("../fixtures/straight.circuit.json")
export const fixture = () => {
  const cj = structuredClone(circuit)
  const ground = { sourcePortId: "g0" }
  const supply = {
    positive: { sourcePortId: "v0" },
    negative: ground,
    voltageV: 3.3,
  }
  const m = { channelReference: { ...ground }, supplies: [supply] }
  cj.push(
    ...["u0", "u1"].map((id, i) => ({
      type: "source_component",
      source_component_id: id,
      name: i ? "RX" : "TX",
      source_group_id: "board-group",
    })),
    {
      type: "source_port",
      source_port_id: "g0",
      source_component_id: "u0",
      name: "GND",
    },
    {
      type: "source_port",
      source_port_id: "v0",
      source_component_id: "u0",
      name: "VDD",
    },
  )
  cj.push({
    type: "source_group",
    source_group_id: "board-group",
    subcircuit_id: "board",
    is_subcircuit: true,
  })
  for (const [index, ids] of [
    ["p0", "p1"],
    ["p2", "p3"],
  ].entries()) {
    cj.push({
      type: "simulation_ibis_model",
      simulation_ibis_model_id: `model-${index}`,
      source_component_id: `u${index}`,
      ibis_model_asset: {
        project_relative_path: "models/test.ibs",
        url: "./models/test.ibs",
        mimetype: "text/plain",
      },
      ibis_component_name: "test",
      ibis_pin_name_to_source_port_id: Object.fromEntries(
        ids.map((id, pin) => [String(pin + 1), id]),
      ),
    })
  }
  cj.push({
    type: "simulation_experiment",
    simulation_experiment_id: "run",
    subcircuit_id: "board",
    name: "data",
    experiment_type: "spice_transient_analysis",
    spice_engine: "pcb_spice",
    end_time_ms: 0.01,
    start_time_ms: 0,
    time_per_step: 0.000001,
  })
  const controls = {
    run: {
      states: ["p0", "p1", "p2", "p3"].map((id, index) => {
        const state = { source_port_id: id, is_output: index < 2 }
        if (state.is_output) state.is_output_enabled = true
        return state
      }),
      stimuli: ["p0", "p1"].map((id, index) => ({
        source_port_id: id,
        name: `stimulus${index}`,
        bit_duration_ms: 0.001,
        start_time_ms: 0,
        initial_state: 0,
        inverted: Boolean(index),
        transmission_pattern: {
          transmission_type: "bits",
          bits: "001110100",
          repeat: true,
        },
      })),
    },
  }
  cj.push(
    {
      type: "simulation_voltage_probe",
      simulation_voltage_probe_id: "diff",
      subcircuit_id: "board",
      name: "diff",
      signal_input_source_port_id: "p2",
      reference_input_source_port_id: "p3",
    },
    {
      type: "simulation_voltage_probe",
      simulation_voltage_probe_id: "single",
      subcircuit_id: "board",
      name: "single",
      signal_input_source_port_id: "p2",
    },
  )
  return {
    cj,
    m,
    controls,
    g: geometryFromCircuitJson(cj, m),
  }
}

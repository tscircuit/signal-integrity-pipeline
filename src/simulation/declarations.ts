/* eslint-disable local/max-file-lines -- Experiment declaration checks share Circuit JSON and IBIS plan types. */
// Experiment declarations (circuitNodes, generalDeclarations, modelRunDefinition).

import type {
  IbisModelDefinition,
  IbisReferencePorts,
  IbisRunConfig,
} from "@tscircuit/ibis-to-spice"
import type {
  SourceComponentBase,
  SourceGroup,
  SourceTrace,
} from "circuit-json"
import type {
  CircuitJson,
  LaneMapping,
  SourceNetId,
  SourcePortId,
} from "../board"
import { selectPort, subcircuitTree } from "../board"
import type { ModelRunDefinition } from "../buffers"
import { fail } from "./diagnostics"
import { transmittedBits } from "./stimulus"
import type {
  CircuitNodes,
  Declarations,
  PipelineIbisModel,
  RunControls,
  SimulationModeling,
  SimulationPlan,
  VoltageProbePlan,
} from "./types"

/** One second contains this many milliseconds. */
const MILLISECONDS_PER_SECOND = 1000

/** Relative slack for rounding when comparing the stimulus and experiment durations. */
const RELATIVE_DURATION_TOLERANCE = 1e-12

/** Validates a declared time in milliseconds and returns it in seconds. */
function secondsFromMilliseconds({
  value,
  label,
  positive = false,
}: {
  value: number | undefined
  label: string
  positive?: boolean
}): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (value > 0 || (!positive && value === 0))
  ) {
    return value / MILLISECONDS_PER_SECOND
  }
  let range = "nonnegative"
  if (positive) range = "positive"
  return fail(
    "simulation_timing",
    `${label}: finite ${range} milliseconds required`,
  )
}

/** Returns the single matching record, failing when a reference matches none or several. */
const exactly = <T>({ items, label }: { items: T[]; label: string }): T => {
  if (items.length !== 1)
    fail(
      "simulation_reference",
      `${label}: expected exactly one record, got ${items.length}`,
    )
  return items[0]
}

interface CircuitNodesInput {
  circuit: CircuitJson
  mappings: readonly LaneMapping[]
  modeling: SimulationModeling
}

/** An identifier that can be used as an electrical node. */
type SourceNodeId = SourcePortId | SourceNetId

/** Representatives used to join source ports and nets before SPICE nodes are numbered. */
type SourceParents = Map<SourceNodeId, SourceNodeId>

/** Registers any source port or net that has no representative yet. */
function addSourceNode({
  parents,
  id,
}: {
  parents: SourceParents
  id: SourceNodeId
}): void {
  if (id && !parents.has(id)) parents.set(id, id)
}

/** Finds the representative of an existing port or net and compresses its path. */
function sourceRoot({
  parents,
  id,
}: {
  parents: SourceParents
  id: SourceNodeId
}): SourceNodeId {
  const parent = parents.get(id)
  if (parent === undefined)
    fail("simulation_reference", `Unknown source port/net ${id}`)
  if (parent === id) return id
  const root = sourceRoot({ parents, id: parent })
  parents.set(id, root)
  return root
}

/** A net record's representative after joining net-only traces across subcircuits. */
function netGroupRoot({
  netGroup,
  id,
}: {
  netGroup: Map<SourceNetId, SourceNetId>
  id: SourceNetId
}): SourceNetId {
  const parent = netGroup.get(id) ?? id
  if (parent === id) return id
  const root = netGroupRoot({ netGroup, id: parent })
  netGroup.set(id, root)
  return root
}

/** Logical source nets attached to a physical port by single-port traces. */
type PortNetBindings = Set<SourceNetId>

/** Lists logical nets for a port, excluding traces that belong to the extracted channel. */
function portNetBindings({
  port,
  traces,
  channelTraces,
  netGroup,
}: {
  port: SourcePortId
  traces: readonly SourceTrace[]
  channelTraces: ReadonlySet<SourceTrace["source_trace_id"]>
  netGroup: Map<SourceNetId, SourceNetId>
}): PortNetBindings {
  const bindings = traces.filter(
    (trace) =>
      !channelTraces.has(trace.source_trace_id) &&
      trace.connected_source_port_ids.length === 1 &&
      trace.connected_source_port_ids[0] === port,
  )
  return new Set(
    bindings
      .flatMap((trace) => trace.connected_source_net_ids ?? [])
      .map((id) => netGroupRoot({ netGroup, id })),
  )
}

/** Names the SPICE node for a port or net ('0' for the reference), rejecting split channel nets. */
function createCircuitNodeLookup({
  parents,
  splitNets,
  names,
}: {
  parents: SourceParents
  splitNets: ReadonlySet<SourceNetId>
  names: Map<SourceNodeId, string>
}): CircuitNodes["node"] {
  return (id) => {
    if (splitNets.has(id))
      fail(
        "channel_net",
        `${id}: extracted channel spans distinct endpoint nodes; select a physical port instead of the net`,
      )
    const root = sourceRoot({ parents, id })
    const name = names.get(root) ?? `n${names.size}`
    names.set(root, name)
    return name
  }
}

/**
 * Resolve electrical connectivity while leaving extracted PCB channel endpoints distinct.
 * The order in which roots are registered also sets the SPICE node numbering.
 */
export function circuitNodes({
  circuit,
  mappings,
  modeling,
}: CircuitNodesInput): CircuitNodes {
  const parents: SourceParents = new Map()
  for (const element of circuit) {
    if (element.type === "source_port")
      addSourceNode({ parents, id: element.source_port_id })
    if (element.type === "source_net")
      addSourceNode({ parents, id: element.source_net_id })
  }
  const channelTraces = new Set(
    mappings.flatMap(
      (mapping) => mapping.sourceTraceIds ?? [mapping.sourceTraceId],
    ),
  )
  const traces = circuit.filter((e) => e.type === "source_trace")
  const nets = circuit.filter((e) => e.type === "source_net")
  // A two-terminal channel can have redundant one-port-to-net declarations
  // from component connections at both ends. Cut only that unambiguous case.
  const splitNets = new Set<SourceNetId>()
  // Subcircuits scope net records: one logical net crossing subcircuits is
  // several records joined by net-only traces. Treat each such group as one net.
  const netGroup = new Map<SourceNetId, SourceNetId>()
  for (const trace of traces) {
    if (
      channelTraces.has(trace.source_trace_id) ||
      trace.connected_source_port_ids.length
    )
      continue
    const [first, ...rest] = trace.connected_source_net_ids ?? []
    for (const id of rest) {
      netGroup.set(
        netGroupRoot({ netGroup, id }),
        netGroupRoot({ netGroup, id: first }),
      )
    }
  }
  for (const mapping of mappings) {
    const from = portNetBindings({
      port: mapping.from,
      traces,
      channelTraces,
      netGroup,
    })
    const to = portNetBindings({
      port: mapping.to,
      traces,
      channelTraces,
      netGroup,
    })
    for (const group of from) {
      if (!to.has(group)) continue
      const ids = new Set(
        nets
          .map((net) => net.source_net_id)
          .filter((id) => netGroupRoot({ netGroup, id }) === group),
      )
      if (nets.some((net) => ids.has(net.source_net_id) && net.is_ground))
        fail("channel_short", `${mapping.port}: channel is bound to ground`)
      const attached = traces.filter((t) =>
        t.connected_source_net_ids?.some((id) => ids.has(id)),
      )
      const hasAdditionalBindings = attached.some((trace) => {
        const nets = trace.connected_source_net_ids!
        return (
          nets.some((id) => !ids.has(id)) ||
          (trace.connected_source_port_ids.length > 0 && nets.length !== 1)
        )
      })
      if (hasAdditionalBindings)
        fail(
          "channel_net",
          `${mapping.port}: shared channel net has additional net bindings; select explicit endpoints`,
        )
      const members = attached.flatMap((t) => t.connected_source_port_ids)
      if (members.some((id) => id !== mapping.from && id !== mapping.to))
        fail(
          "channel_fanout",
          `${mapping.port}: shared channel net has additional ports; bind loads to an explicit endpoint`,
        )
      for (const id of ids) splitNets.add(id)
    }
  }
  for (const trace of traces) {
    if (channelTraces.has(trace.source_trace_id)) continue
    // Keep all explicit port-to-port paths, including genuine ideal bypasses.
    const connected = [
      ...(trace.connected_source_port_ids ?? []),
      ...(trace.connected_source_net_ids ?? []).filter(
        (id) => !splitNets.has(id),
      ),
    ]
    for (const id of connected) addSourceNode({ parents, id })
    for (const id of connected.slice(1)) {
      parents.set(
        sourceRoot({ parents, id }),
        sourceRoot({ parents, id: connected[0] }),
      )
    }
  }
  const ground = selectPort({
    circuit,
    selector: modeling.channelReference,
  }).source_port_id
  const groundRoot = sourceRoot({ parents, id: ground })
  const names = new Map([[groundRoot, "0"]])
  const node = createCircuitNodeLookup({ parents, splitNets, names })
  const ids = [...parents.keys()].filter((id) => !splitNets.has(id))
  for (const id of ids) node(id)
  // Adjacent routed segments can share one physical endpoint, such as a receiver with a termination.
  const endpoints = new Set(
    mappings.flatMap((mapping) => [mapping.from, mapping.to]),
  )
  const endpointNodes = [...endpoints].map(node)
  const collapsedLane = mappings.some((mapping) => mapping.from === mapping.to)
  if (
    collapsedLane ||
    endpointNodes.includes("0") ||
    new Set(endpointNodes).size !== endpoints.size
  )
    fail(
      "channel_short",
      "Extracted endpoints are shorted by another ideal source trace or reference",
    )
  return {
    node,
    groundSourcePortId: ground,
    mapping: Object.fromEntries(ids.map((id) => [id, node(id)])),
  }
}

/** Finds a modeled component's subcircuit through its groups, or returns null at board level. */
function componentScope({
  id,
  components,
  groups,
}: {
  id: SourceComponentBase["source_component_id"] | undefined
  components: readonly SourceComponentBase[]
  groups: ReadonlyMap<SourceGroup["source_group_id"], SourceGroup>
}): NonNullable<SourceComponentBase["subcircuit_id"]> | null {
  const component = components.find(
    (record) => record.source_component_id === id,
  )
  if (!component)
    fail("simulation_scope", "Missing component for scoped physical port")
  if (component.subcircuit_id) return component.subcircuit_id
  let groupId = component.source_group_id
  const visited = new Set<SourceGroup["source_group_id"]>()
  while (groupId) {
    if (visited.has(groupId))
      fail("simulation_scope", "Cyclic source-group ownership")
    visited.add(groupId)
    const group = groups.get(groupId)
    if (!group)
      fail("simulation_scope", "Missing source group for modeled component")
    if (group.subcircuit_id) return group.subcircuit_id
    groupId = group.parent_source_group_id
  }
  return null
}

/**
 * Combines experiment timing and probes with the lowered IBIS run controls.
 * Every reference is checked here, before any solver runs.
 */
export function generalDeclarations({
  circuit,
  mappings,
  modeling,
  controls,
}: CircuitNodesInput & {
  controls: Record<string, RunControls>
}): Declarations {
  const referencedTypes = [
    "simulation_experiment",
    "simulation_ibis_model",
    "simulation_voltage_probe",
    "source_port",
    "source_net",
    "source_component",
  ]
  for (const type of referencedTypes) {
    const seen = new Set<string>()
    for (const record of circuit.filter((e) => e.type === type)) {
      const id: unknown = Reflect.get(record, `${type}_id`)
      if (typeof id !== "string" || !id)
        fail("simulation_reference", `${type}: nonempty identifier required`)
      if (seen.has(id))
        fail("simulation_reference", `Duplicate ${type} identifier ${id}`)
      seen.add(id)
    }
  }
  const errors = circuit
    .filter((e) => e.type === "source_invalid_component_property_error")
    .filter((e) =>
      [
        "ibisModel",
        "ibisPinStates",
        "probeRef",
        "simulationRef",
        "sourcePinRef",
        "bitDuration",
        "transmittedData",
      ].includes(e.property_name),
    )
  if (errors.length)
    fail("native_declaration", errors.map((e) => e.message).join("; "))
  const models = circuit
    .filter((e) => e.type === "simulation_ibis_model")
    .map((model, i) => ({
      ...model,
      pipelineId: model.simulation_ibis_model_id ?? `model-${i}`,
    }))
  if (!models.length)
    fail("ibis_model", "At least one serialized native IBIS model required")
  const nodes = circuitNodes({ circuit, mappings, modeling })
  const ports = new Map(
    circuit
      .filter((e) => e.type === "source_port")
      .map((e) => [e.source_port_id, e]),
  )
  const groups = new Map(
    circuit
      .filter((e) => e.type === "source_group")
      .map((e) => [e.source_group_id, e]),
  )
  const components = circuit.filter((e) => e.type === "source_component")
  const subcircuits = subcircuitTree(circuit)
  for (const model of models) {
    const sourceComponent = exactly({
      items: components.filter(
        (e) => e.source_component_id === model.source_component_id,
      ),
      label: `${model.pipelineId} component`,
    })
    for (const refs of Object.values(
      model.ibis_pin_name_to_reference_source_port_ids ?? {},
    ))
      for (const id of Object.values(refs))
        if (
          id !== undefined &&
          (!ports.has(id) ||
            ports.get(id)?.source_component_id !==
              sourceComponent.source_component_id)
        )
          fail(
            "ibis_mapping",
            `${sourceComponent.name}: reference port points outside its chip`,
          )
    for (const id of Object.values(model.ibis_pin_name_to_source_port_id ?? {}))
      if (
        !ports.has(id) ||
        ports.get(id)?.source_component_id !==
          sourceComponent.source_component_id
      )
        fail(
          "ibis_mapping",
          `${sourceComponent.name}: physical pin mapping points outside its chip`,
        )
  }
  const declaredExperiments = circuit.filter(
    (e) => e.type === "simulation_experiment",
  )
  const experiments = declaredExperiments.filter(
    (experiment) => experiment.spice_engine === "pcb_spice",
  )
  if (!experiments.length)
    fail(
      "simulation_experiment",
      "A transient experiment with spiceEngine=pcb_spice is required",
    )
  const pcbExperimentIds = new Set(
    experiments.map((experiment) => experiment.simulation_experiment_id),
  )
  if (
    experiments.some(
      (experiment) => experiment.experiment_type !== "spice_transient_analysis",
    ) ||
    circuit.some(
      (e) =>
        e.type === "simulation_parameter_sweep" &&
        pcbExperimentIds.has(e.simulation_experiment_id),
    )
  )
    fail(
      "simulation_capability",
      "This PCB backend supports unswept transient experiments only",
    )
  const ids = new Set<string>()
  const plans: SimulationPlan[] = experiments.map(
    (experiment): SimulationPlan => {
      const id = experiment.simulation_experiment_id
      if (!id || ids.has(id))
        fail("simulation_experiment", "Experiment IDs must be unique")
      ids.add(id)
      const scopes = new Set(
        models.map((model) =>
          componentScope({ id: model.source_component_id, components, groups }),
        ),
      )
      let scope: string | null | undefined =
        experiment.subcircuit_id ?? undefined
      if (scope === undefined && scopes.size === 1) scope = [...scopes][0]
      if (scope === undefined)
        fail(
          "simulation_scope",
          `${experiment.name}: multiple modeled subcircuits require an explicit experiment scope`,
        )
      const scopedModels = models.filter((model) => {
        const inner = componentScope({
          id: model.source_component_id,
          components,
          groups,
        })
        return subcircuits.within({ inner, outer: scope })
      })
      if (!scopedModels.length)
        fail(
          "simulation_scope",
          `${experiment.name}: no models in its explicit subcircuit scope`,
        )
      for (const mapping of mappings) {
        for (const endpoint of [mapping.from, mapping.to]) {
          const port = ports.get(endpoint)
          if (!port)
            fail(
              "ibis_mapping",
              `${mapping.port}: missing channel endpoint ${endpoint}`,
            )
          const inner = componentScope({
            id: port.source_component_id,
            components,
            groups,
          })
          if (!subcircuits.within({ inner, outer: scope })) {
            const advice = "separate channel configurations are required"
            const detail = `this explicit PCB channel belongs to another scope; ${advice}`
            fail("simulation_scope", `${experiment.name}: ${detail}`)
          }
        }
      }
      const durationSeconds = secondsFromMilliseconds({
        value: experiment.end_time_ms,
        label: `${id} end_time_ms`,
        positive: true,
      })
      const startTimeSeconds = secondsFromMilliseconds({
        value: experiment.start_time_ms ?? 0,
        label: `${id} start_time_ms`,
      })
      const maxStepSeconds = secondsFromMilliseconds({
        value: experiment.time_per_step,
        label: `${id} time_per_step`,
        positive: true,
      })
      if (
        startTimeSeconds >= durationSeconds ||
        maxStepSeconds >= durationSeconds - startTimeSeconds
      )
        fail(
          "simulation_timing",
          `${experiment.name}: recording must have positive duration and a smaller maximum timestep`,
        )
      let runControls: RunControls = { states: [], stimuli: [] }
      if (Object.hasOwn(controls, id)) runControls = controls[id]
      const { states, stimuli: controlsForRun } = runControls
      const stimuli = controlsForRun.map((stimulus) => ({
        ...stimulus,
        transmission_pattern: {
          ...stimulus.transmission_pattern,
          bits: transmittedBits({ value: stimulus.transmission_pattern?.bits }),
        },
      }))
      const stateIds = new Set<string>()
      const stimulusIds = new Set<string>()
      for (const state of states) {
        if (stateIds.has(state.source_port_id))
          fail(
            "ibis_state",
            `${experiment.name}: duplicate run state for ${state.source_port_id}`,
          )
        stateIds.add(state.source_port_id)
        const hasOutputFlag = typeof state.is_output === "boolean"
        let validEnableFlag: boolean
        if (state.is_output) {
          validEnableFlag = typeof state.is_output_enabled === "boolean"
        } else {
          validEnableFlag = state.is_output_enabled === undefined
        }
        if (!hasOutputFlag || !validEnableFlag) {
          fail(
            "ibis_state",
            `${experiment.name}: explicit compatible input/output enable state required`,
          )
        }
        const attachments = scopedModels.filter((model) =>
          Object.values(model.ibis_pin_name_to_source_port_id).includes(
            state.source_port_id,
          ),
        )
        if (attachments.length !== 1)
          fail(
            "ibis_state",
            `${experiment.name}: run state must select exactly one modeled pin`,
          )
      }
      const passiveTypes = [
        "simple_resistor",
        "simple_capacitor",
        "simple_inductor",
      ]
      for (const mapping of mappings) {
        for (const endpoint of [mapping.from, mapping.to]) {
          const modeledPorts = scopedModels.flatMap((model) =>
            Object.values(model.ibis_pin_name_to_source_port_id),
          )
          const bindings = modeledPorts.filter((port) => port === endpoint)
          if (bindings.length === 1 && stateIds.has(endpoint)) continue
          if (bindings.length === 0) {
            const componentId = ports.get(endpoint)?.source_component_id
            const isPassive = components.some(
              (component) =>
                component.source_component_id === componentId &&
                passiveTypes.includes(component.ftype),
            )
            if (isPassive) continue
          }
          const requirement =
            "requires exactly one modeled physical pin and an explicit run state"
          fail(
            "channel_model",
            `${experiment.name} ${mapping.port}: endpoint ${endpoint} ${requirement}`,
          )
        }
      }
      for (const stimulus of stimuli) {
        if (stimulusIds.has(stimulus.source_port_id))
          fail(
            "stimulus_duplicate",
            `${experiment.name}: multiple stimuli drive the same physical output`,
          )
        stimulusIds.add(stimulus.source_port_id)
        const state = states.find(
          (s) => s.source_port_id === stimulus.source_port_id,
        )
        if (state?.is_output !== true || state.is_output_enabled !== true)
          fail(
            "stimulus_state",
            `${stimulus.name}: stimulus requires an enabled IBIS output in this experiment`,
          )
        secondsFromMilliseconds({
          value: stimulus.bit_duration_ms,
          label: `${stimulus.name} bit_duration_ms`,
          positive: true,
        })
        secondsFromMilliseconds({
          value: stimulus.start_time_ms,
          label: `${stimulus.name} start_time_ms`,
        })
        const hasBinaryInitialState = [0, 1].includes(stimulus.initial_state)
        const hasValidInversion =
          stimulus.inverted === undefined ||
          typeof stimulus.inverted === "boolean"
        const pattern = stimulus.transmission_pattern
        const hasValidBitPattern =
          pattern?.transmission_type === "bits" &&
          typeof pattern.repeat === "boolean"
        if (
          !hasBinaryInitialState ||
          !hasValidInversion ||
          !hasValidBitPattern
        ) {
          const requirements =
            "explicit binary bits, inversion/repeat booleans and initial state required"
          fail("stimulus_pattern", `${stimulus.name}: ${requirements}`)
        }
        if (stimulus.start_time_ms / MILLISECONDS_PER_SECOND >= durationSeconds)
          fail(
            "stimulus_coverage",
            `${stimulus.name}: stimulus starts after the experiment ends`,
          )
        if (pattern.repeat) continue
        const patternDurationMs = pattern.bits.length * stimulus.bit_duration_ms
        const endSeconds =
          (stimulus.start_time_ms + patternDurationMs) / MILLISECONDS_PER_SECOND
        const durationToleranceSeconds =
          RELATIVE_DURATION_TOLERANCE * durationSeconds
        if (endSeconds < durationSeconds - durationToleranceSeconds) {
          fail(
            "stimulus_coverage",
            `${stimulus.name}: nonrepeating bits do not cover the complete run`,
          )
        }
      }
      for (const state of states) {
        if (
          state.is_output &&
          state.is_output_enabled &&
          !stimulusIds.has(state.source_port_id)
        ) {
          fail(
            "stimulus_missing",
            `${experiment.name}: enabled output requires one explicit digital stimulus`,
          )
        }
      }
      const probes = circuit
        .filter((e) => e.type === "simulation_voltage_probe")
        .filter((e) =>
          subcircuits.within({ inner: e.subcircuit_id, outer: scope }),
        )
        .map((probe, i): VoltageProbePlan => {
          const signal =
            probe.signal_input_source_port_id ??
            probe.signal_input_source_net_id
          const reference =
            probe.reference_input_source_port_id ??
            probe.reference_input_source_net_id
          if (!signal)
            fail("probe_reference", `${probe.name}: signal port/net required`)
          for (const source of [signal, reference].filter(Boolean)) {
            const exists = circuit.some(
              (record) =>
                (record.type === "source_port" &&
                  record.source_port_id === source) ||
                (record.type === "source_net" &&
                  record.source_net_id === source),
            )
            if (!exists)
              fail(
                "probe_reference",
                `${probe.name}: unknown signal/reference source`,
              )
          }
          const signalNode = nodes.node(signal)
          let referenceNode = "0"
          if (reference) referenceNode = nodes.node(reference)
          if (signalNode === referenceNode)
            fail(
              "probe_reference",
              `${probe.name}: signal and reference resolve to the same circuit node`,
            )
          return {
            simulationVoltageProbeId: probe.simulation_voltage_probe_id,
            name: probe.name ?? probe.simulation_voltage_probe_id,
            column: i + 1,
            signalSourceId: signal,
            referenceSourceId: reference ?? null,
            signalNode,
            referenceNode,
          }
        })
      if (!probes.length)
        fail(
          "simulation_probe",
          `${experiment.name}: at least one voltage probe required`,
        )

      return {
        simulationExperimentId: id,
        name: experiment.name,
        subcircuitId: scope,
        durationSeconds,
        startTimeSeconds,
        maxStepSeconds,
        experiment,
        states,
        stimuli,
        probes,
        models: scopedModels,
      }
    },
  )
  const usedModelIds = new Set(
    plans.flatMap((plan) => plan.models.map((model) => model.pipelineId)),
  )
  return {
    models: models.filter((model) => usedModelIds.has(model.pipelineId)),
    nodes,
    plans,
    ports,
  }
}

/**
 * Builds the converter input for one model in one experiment: its source, pin map, references, corner,
 * and the run's pin states and stimuli. Dictionaries have no prototype so any port name is safe as a key.
 */
export function modelRunDefinition({
  model,
  plan,
}: {
  model: PipelineIbisModel
  plan: Pick<SimulationPlan, "durationSeconds" | "states" | "stimuli">
}): ModelRunDefinition {
  const pinMap = model.ibis_pin_name_to_source_port_id
  const selected = new Set(Object.values(pinMap))
  const pinStates: IbisRunConfig["pinStates"] = Object.create(null)
  const stimuli: IbisRunConfig["stimuli"] = Object.create(null)
  for (const state of plan.states) {
    if (!selected.has(state.source_port_id)) continue
    if (!state.is_output) {
      pinStates[state.source_port_id] = { mode: "input" }
      continue
    }
    if (typeof state.is_output_enabled !== "boolean")
      fail(
        "ibis_state",
        `${state.source_port_id}: explicit output enable state required`,
      )
    pinStates[state.source_port_id] = {
      mode: "output",
      enabled: state.is_output_enabled,
    }
  }
  for (const stimulus of plan.stimuli) {
    if (!selected.has(stimulus.source_port_id)) continue
    stimuli[stimulus.source_port_id] = {
      unitInterval: stimulus.bit_duration_ms,
      startTime: stimulus.start_time_ms,
      initialState: stimulus.initial_state,
      inverted: stimulus.inverted ?? false,
      pattern: {
        type: "bits",
        bits: stimulus.transmission_pattern.bits,
        repeat: stimulus.transmission_pattern.repeat,
      },
    }
  }
  const pinReferenceEntries = Object.entries(
    model.ibis_pin_name_to_reference_source_port_ids ?? {},
  )
  const selectedReferences = pinReferenceEntries.filter(
    ([pin]) => pin in pinMap,
  )
  const references: Record<string, IbisReferencePorts> = Object.fromEntries(
    selectedReferences.map(([pin, refs]) => {
      const ports: IbisReferencePorts = {
        pullup: refs.pullup_reference_source_port_id,
        pulldown: refs.pulldown_reference_source_port_id,
        powerClamp: refs.power_clamp_reference_source_port_id,
        groundClamp: refs.ground_clamp_reference_source_port_id,
      }
      if (refs.external_reference_source_port_id)
        ports.external = refs.external_reference_source_port_id
      return [pin, ports]
    }),
  )
  const packagePolicy: IbisModelDefinition["packagePolicy"] = "vendor"
  let modelSelections: IbisModelDefinition["modelSelections"]
  if (model.ibis_pin_name_to_model_name) {
    const selectedModels = Object.entries(
      model.ibis_pin_name_to_model_name,
    ).filter(([pin]) => pin in pinMap)
    modelSelections = Object.fromEntries(selectedModels)
  }
  return {
    definition: {
      source: { file: model.ibis_model_asset.project_relative_path },
      component: model.ibis_component_name,
      pinMap,
      modelSelections,
      references,
      corner: "typical",
      packagePolicy,
    },
    run: {
      duration: plan.durationSeconds * MILLISECONDS_PER_SECOND,
      pinStates,
      stimuli,
    },
  }
}

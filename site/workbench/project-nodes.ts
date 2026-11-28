import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import {
  endpointPorts,
  type SimulationPcbDriverReceiverChannel,
  type SourcePortId,
} from "../../src/board"
import type { InspectorFeature } from "../channel-inspector/geometry"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"
import {
  displayAsset,
  displayBuffer,
  embeddedModels,
  modelPins,
} from "./model/ibis"
import { qualifiedPort } from "./model/labels"
import { tracePorts } from "./model/net-roles"
import { stimulusRadius } from "./model/stimulus"
import type { ProjectNode, ResultNode } from "./project"

/** Shared board lookups for simulation and component branches. */
interface BoardBranches {
  input: InspectorInput
  db: CircuitJsonUtilObjects
  features: InspectorFeature[]
  featurePorts: Map<InspectorFeature["id"], SourcePortId[]>
}

/** Build the tree and property rows for a declared victim. */
function channelNode({
  channel,
  db,
  copper,
  featurePorts,
}: {
  channel: SimulationPcbDriverReceiverChannel
  db: CircuitJsonUtilObjects
  copper: InspectorFeature[]
  featurePorts: BoardBranches["featurePorts"]
}): ProjectNode {
  const ports = new Set(endpointPorts(channel.driver))
  const feature = copper.find(
    (entry) =>
      entry.category === "selected" &&
      featurePorts.get(entry.id)?.some((port) => ports.has(port)),
  )
  return {
    id: channel.simulation_pcb_driver_receiver_channel_id,
    label: channel.name,
    icon: "stimulus",
    copper: feature,
    swatch: true,
    port: ports.values().next().value,
    description:
      "Driver, receiver pins, and stimulus for this transient channel.",
    groups: [
      {
        name: "Channel",
        fields: [
          [
            "Driver",
            [...ports].map((port) => qualifiedPort({ db, port })).join(", "),
          ],
          [
            "Receivers",
            channel.receivers
              .flatMap(endpointPorts)
              .map((port) => qualifiedPort({ db, port }))
              .join(", "),
          ],
          ["Pattern", channel.pattern],
          ["Bit rate", `${channel.bit_rate_bps / 1e6} Mbps`],
        ],
      },
    ],
  }
}

/** Name one scoped physical copper feature using its net or source port. */
function copperNode({
  feature,
  db,
  port,
}: {
  feature: InspectorFeature
  db: CircuitJsonUtilObjects
  port?: SourcePortId
}): ProjectNode {
  const record = feature.record
  let label = port ? qualifiedPort({ db, port }) : feature.id
  if (record.type !== "pcb_trace" && record.source_net_id) {
    const name = db.source_net.get(record.source_net_id)?.name
    if (name) label = `${name} · ${record.type === "pcb_via" ? "Via" : "Pour"}`
  }
  return {
    id: feature.id,
    label,
    icon: "pin",
    copper: feature,
    swatch: true,
    port,
  }
}

/** Collect the simulations with their declared channels and scoped copper. */
function simulationNodes({
  input,
  db,
  features,
  featurePorts,
  active,
}: BoardBranches & { active?: ChannelSimulation }): ProjectNode[] {
  return input.simulations.map((simulation, index): ProjectNode => {
    const id = simulation.simulation_pcb_transient_channel_simulation_id
    const channels = db.simulation_pcb_driver_receiver_channel.list({
      simulation_pcb_transient_channel_simulation_id: id,
    })
    const copper = simulation === active ? features : []
    const buckets = [
      { name: "Channels (Victims)", category: "selected" },
      { name: "Aggressors", category: "near" },
      { name: "Rails", category: "rail" },
      { name: "Far Nets", category: "far" },
    ] as const
    return {
      id,
      label: simulation.name ?? id,
      icon: "stimulus",
      simulation: index,
      collapsed: simulation !== active,
      current: simulation === active,
      groups: [
        {
          name: "Timing",
          fields: [
            ["Bit rate", `${simulation.bit_rate_bps / 1e6} Mbps`],
            [
              "Duration",
              simulation.duration_ms === undefined
                ? "Automatic"
                : `${simulation.duration_ms * 1e6} ns`,
            ],
            [
              "Scope radius",
              `${stimulusRadius({ simulation, defaultMm: input.distanceMm })} mm`,
            ],
          ],
        },
        {
          name: "Aggressors",
          fields: [
            ["Pattern", simulation.aggressor_pattern ?? "Unspecified"],
            ["Disabled", simulation.aggressor_disabled ? "Yes" : "No"],
          ],
        },
      ],
      description:
        "A transient simulation groups victim channels, aggressor settings, and a recording duration.",
      children: buckets.map(
        ({ name, category }): ProjectNode => ({
          id: `${id}:${category}`,
          label: name,
          icon: "folder",
          collapsed: category === "rail",
          children:
            category === "selected"
              ? channels.map((channel) =>
                  channelNode({ channel, db, copper, featurePorts }),
                )
              : copper
                  .filter((feature) => feature.category === category)
                  .map((feature) =>
                    copperNode({
                      feature,
                      db,
                      port: featurePorts.get(feature.id)?.[0],
                    }),
                  ),
        }),
      ),
    }
  })
}

/** Collect components and their actual embedded pin bindings. */
function componentNodes({
  input,
  db,
  features,
  featurePorts,
}: BoardBranches): ProjectNode[] {
  const models = embeddedModels(input.circuit)
  const pins = modelPins({ circuit: input.circuit, models })
  return db.source_component.list().map((component): ProjectNode => {
    const id = component.source_component_id
    const model = models.find(
      ({ record }) => record.source_component_id === id,
    )?.record
    const ports = db.source_port.list({ source_component_id: id })
    return {
      id,
      label: component.name ?? id,
      icon: "models",
      collapsed: true,
      modelId: model?.simulation_ibis_model_id,
      groups: [
        {
          name: "Component",
          fields: [
            ["ID", id],
            ["Type", component.ftype],
            ["IBIS component", model?.ibis_component_name ?? "Unassigned"],
          ],
        },
      ],
      children: ports.map((port) => {
        const binding = pins.find(({ port: id }) => id === port.source_port_id)
        const pin = binding?.pin
        const name = binding?.name
        return {
          id: port.source_port_id,
          port: port.source_port_id,
          label: `Pin ${port.pin_number ?? pin ?? "—"}: ${port.name ?? port.source_port_id}${name ? ` [${displayBuffer(name)}]` : ""}`,
          icon: "pin",
          buffer: name,
          modelId: model?.simulation_ibis_model_id,
          copper: features.find((feature) =>
            featurePorts.get(feature.id)?.includes(port.source_port_id),
          ),
          groups: [
            {
              name: "Pin",
              fields: [
                ["Component", component.name ?? id],
                ["Pin", pin ?? port.pin_number ?? "—"],
                ["Port", port.name ?? port.source_port_id],
              ],
            },
            {
              name: "IBIS model",
              fields: [
                ["Assigned model", displayBuffer(name)],
                ["Corner", binding?.corner ?? "—"],
                ["Asset", model ? displayAsset(model) : "—"],
              ],
            },
          ],
        }
      }),
    }
  })
}

/** Describe physical layers in the same order as the stackup editor. */
function stackupNodes(db: CircuitJsonUtilObjects): ProjectNode[] {
  const layers = db.pcb_stackup.getWhere({})?.layers ?? []
  return layers.map((layer, index): ProjectNode => {
    const name =
      ("layer" in layer ? layer.layer : undefined) ??
      ("material_name" in layer && layer.material_name) ??
      layer.layer_type
    return {
      id: `layer:${index}`,
      label: `${name || layer.layer_type} · ${layer.thickness} mm`,
      icon: "stackup",
      window: "stackup",
      groups: [
        {
          name: "Physical",
          fields: [
            ["Layer", name || "—"],
            ["Type", layer.layer_type],
            ["Thickness", `${layer.thickness} mm`],
            [
              "Dk",
              "relative_permittivity" in layer
                ? (layer.relative_permittivity ?? "—")
                : "—",
            ],
            ["Df", "loss_tangent" in layer ? (layer.loss_tangent ?? "—") : "—"],
            [
              "Conductivity",
              "electrical_conductivity_s_per_m" in layer
                ? (layer.electrical_conductivity_s_per_m ?? "—")
                : "—",
            ],
          ],
        },
      ],
    }
  })
}

/** Give the project tree and property grid the same board, pin, and capture records. */
export function projectNodes({
  input,
  active,
  features,
  results = [],
}: {
  input: InspectorInput
  active?: ChannelSimulation
  features: InspectorFeature[]
  results?: ResultNode[]
}): ProjectNode {
  const db = cju([...input.circuit])
  const featurePorts = new Map(
    features.flatMap((feature) => {
      if (feature.record.type !== "pcb_trace") return []
      return [
        [
          feature.id,
          tracePorts({ circuit: input.circuit, trace: feature.record }),
        ] as const,
      ]
    }),
  )
  const simulations = simulationNodes({
    input,
    db,
    active,
    features,
    featurePorts,
  })
  const components = componentNodes({ input, db, features, featurePorts })
  return {
    id: "board",
    label: input.name,
    icon: "board",
    window: "board",
    groups: [
      {
        name: "Geometry",
        fields: [
          ["Width", `${input.board.width} mm`],
          ["Height", `${input.board.height} mm`],
          ["Thickness", `${Number(input.board.thickness.toPrecision(8))} mm`],
          ["Copper layers", input.board.layers.length],
        ],
      },
    ],
    description:
      "Dimensions are derived from the PCB outline and physical stackup.",
    children: [
      {
        id: "simulations",
        label: "Simulations",
        icon: "folder",
        children: simulations,
        description:
          "Select a transient simulation to inspect its routed copper.",
      },
      {
        id: "components",
        label: "Components",
        icon: "folder",
        children: components,
      },
      {
        id: "stackup",
        label: "Stackup",
        icon: "stackup",
        window: "stackup",
        collapsed: true,
        children: stackupNodes(db),
      },
      {
        id: "results",
        label: "Results",
        icon: "scope",
        window: "scope",
        children: results.map(
          (run): ProjectNode => ({
            id: `run:${run.id}`,
            run: run.id,
            label: run.label,
            icon: "scope",
            window: "scope",
            groups: [{ name: "Capture", fields: run.fields }],
          }),
        ),
      },
    ],
  }
}

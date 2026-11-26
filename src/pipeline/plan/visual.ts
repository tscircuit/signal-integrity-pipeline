import { type CircuitJsonUtilObjects, cju } from "@tscircuit/circuit-json-util"
import {
  type CircuitJson,
  endpointPorts,
  indexPlanPorts,
  type PlanVisualScene,
  type SimulationPcbDriverReceiverChannel,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
  type SourceTraceId,
} from "../../board"
import { Diagnostic } from "../../kernel"
import type { TransientChannelSimulationPlan } from "../transient-channel-simulation-plan"
import { buildEndpoints } from "./endpoints"
import { resolvePlanFault } from "./fault"
import { buildPathRows } from "./rows"
import { buildSceneDiagnostic, summarizePlan } from "./summary"
import { type PlanTopology, resolvePlanTopology } from "./visual-topology"

/** The declaration and original diagnostic captured before the solver reports a failure. */
export interface FailedPlanAttempt {
  channelSimulation?: SimulationPcbTransientChannelSimulation
  error: unknown
}

/** A declared driver/receiver pair, keeping differential polarity. */
export interface PlanPath {
  channelName: string
  simulationPcbDriverReceiverChannelId: SimulationPcbDriverReceiverChannel["simulation_pcb_driver_receiver_channel_id"]
  legLabel: string
  fromSourcePortId: SourcePortId
  toSourcePortId: SourcePortId
}

/** Resolve one path for each declared receiver leg, even if it never reached binding. */
function listDeclaredPaths(
  channels: readonly SimulationPcbDriverReceiverChannel[],
): PlanPath[] {
  return channels.flatMap(
    ({
      name,
      driver,
      receivers,
      simulation_pcb_driver_receiver_channel_id,
    }) => {
      const drivers = endpointPorts(driver)
      return receivers.flatMap((receiver) =>
        endpointPorts(receiver).map((toSourcePortId, leg) => {
          let legLabel = name
          if (drivers.length > 1) legLabel += ["+", "−"][leg]
          return {
            channelName: name,
            simulationPcbDriverReceiverChannelId:
              simulation_pcb_driver_receiver_channel_id,
            legLabel,
            fromSourcePortId: drivers[leg],
            toSourcePortId,
          }
        }),
      )
    },
  )
}

/** Identity of the simulation shown, suppressing the default generated name. */
interface PlanAttemptSelection {
  simulationPcbTransientChannelSimulationId?: TransientChannelSimulationPlan["simulationPcbTransientChannelSimulationId"]
  simulationName?: string
}

/** A failed attempt takes precedence over any previously completed plan. */
function selectPlanAttempt({
  plan,
  failed,
}: {
  plan?: TransientChannelSimulationPlan
  failed?: FailedPlanAttempt
}): PlanAttemptSelection {
  let simulationPcbTransientChannelSimulationId =
    plan?.simulationPcbTransientChannelSimulationId
  let name = plan?.name
  if (failed) {
    simulationPcbTransientChannelSimulationId =
      failed.channelSimulation?.simulation_pcb_transient_channel_simulation_id
    name = failed.channelSimulation?.name
  }
  let simulationName = name
  if (name === simulationPcbTransientChannelSimulationId)
    simulationName = undefined
  return { simulationPcbTransientChannelSimulationId, simulationName }
}

/** Routed traces touching a declared endpoint and all ports with routed copper. */
interface RoutedEvidence {
  existingSourceTraceIds: Set<SourceTraceId>
  partiallyRoutedSourcePortIds: Set<SourcePortId>
}

/** Index already routed copper even when the simulation plan fails. */
function indexRoutedEvidence({
  db,
  paths,
}: {
  db: CircuitJsonUtilObjects
  paths: readonly PlanPath[]
}): RoutedEvidence {
  const routedSourceTraceIds = new Set(
    db.pcb_trace.list().map(({ source_trace_id }) => source_trace_id),
  )
  const pathSourcePortIds = new Set(
    paths.flatMap(({ fromSourcePortId, toSourcePortId }) => [
      fromSourcePortId,
      toSourcePortId,
    ]),
  )
  const existingSourceTraceIds = new Set<SourceTraceId>()
  const partiallyRoutedSourcePortIds = new Set<SourcePortId>()
  for (const trace of db.source_trace.list()) {
    const {
      source_trace_id: sourceTraceId,
      connected_source_port_ids: sourcePortIds,
    } = trace
    if (!routedSourceTraceIds.has(sourceTraceId)) continue
    for (const sourcePortId of sourcePortIds)
      partiallyRoutedSourcePortIds.add(sourcePortId)
    if (
      sourcePortIds.some((sourcePortId) => pathSourcePortIds.has(sourcePortId))
    )
      existingSourceTraceIds.add(sourceTraceId)
  }
  return { existingSourceTraceIds, partiallyRoutedSourcePortIds }
}

/** Describe the plan stage without claiming that binding or simulation has run. */
function getPlanTitle({
  simulationName,
  hasDiagnostic,
  hasPlan,
  solved,
}: {
  simulationName?: string
  hasDiagnostic: boolean
  hasPlan: boolean
  solved: boolean
}): string {
  if (hasDiagnostic) return `${simulationName || "Plan"}: can't simulate`
  if (hasPlan && simulationName) return `${simulationName}: plan ready`
  if (hasPlan) return "Plan: ready"
  if (solved) return "Plan: no signals to simulate"
  return "Plan: waiting to run"
}

/** Build the drawing data for the latest planning attempt. */
export function buildPlanVisualScene({
  circuitJson,
  plan,
  failed,
  error,
  solved,
}: {
  circuitJson: CircuitJson
  plan?: TransientChannelSimulationPlan
  failed?: FailedPlanAttempt
  error: string | null
  solved: boolean
}): PlanVisualScene {
  const db = cju([...circuitJson])
  const { simulationPcbTransientChannelSimulationId, simulationName } =
    selectPlanAttempt({ plan, failed })
  const channels = db.simulation_pcb_driver_receiver_channel
    .list()
    .filter(
      (channel) =>
        channel.simulation_pcb_transient_channel_simulation_id ===
        simulationPcbTransientChannelSimulationId,
    )
  const paths = listDeclaredPaths(channels)
  const ports = indexPlanPorts(db)
  const labels = new Map(
    [...ports].map(([sourcePortId, port]) => [sourcePortId, port.label]),
  )
  let topology: PlanTopology | undefined
  if (plan && !failed)
    topology = resolvePlanTopology({
      plan,
      paths,
      placedSourcePortIds: new Set(ports.keys()),
    })
  let issue = topology?.issue
  if (failed?.error instanceof Diagnostic) issue = failed.error
  const { partiallyRoutedSourcePortIds, existingSourceTraceIds } =
    indexRoutedEvidence({ db, paths })
  const fault = resolvePlanFault({
    db,
    issue,
    paths,
    topology,
    partiallyRoutedSourcePortIds,
  })
  const diagnostic = buildSceneDiagnostic({
    error,
    failed,
    issue,
    paths,
    topology,
    fault,
    db,
  })
  const endpoints = buildEndpoints({ paths, topology, labels })
  const copperScope = topology && plan?.sections.copperScope
  let summary: PlanVisualScene["summary"]
  if (!diagnostic && topology)
    summary = summarizePlan({
      topology,
      db,
      nearbyGapMm: copperScope?.nearbyGapMm,
    })
  let traceFaultKind: PlanVisualScene["traceFaultKind"]
  if (issue?.code === "channel_fanout") {
    traceFaultKind = "loop"
    if ("rejections" in issue) traceFaultKind = "branch"
  }
  return {
    db,
    ports,
    title: getPlanTitle({
      simulationName,
      hasDiagnostic: diagnostic !== undefined,
      hasPlan: plan !== undefined,
      solved,
    }),
    diagnostic,
    copperScope,
    summary,
    traces: topology?.traces || [],
    endpoints,
    overlays: [...(topology?.overlays || []), ...fault.overlays],
    rows: buildPathRows({ topology, paths, fault, db }),
    traceFaultKind,
    faultSourcePortIds: fault.sourcePortIds,
    faultSourceTraceIds: fault.sourceTraceIds,
    existingSourceTraceIds,
  }
}

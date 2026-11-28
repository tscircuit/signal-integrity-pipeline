import { cju } from "@tscircuit/circuit-json-util"
import { createHttpSolver } from "../../src/adapters/browser"
import {
  type CircuitJson,
  endpointPorts,
  type SourcePortId,
} from "../../src/board"
import type { IbisSources } from "../../src/buffers"
import { Diagnostic } from "../../src/kernel"
import {
  RoutedPipelineSolver,
  routedStages,
  TransientChannelSimulationPlanSolver,
} from "../../src/pipeline"
import type {
  ReceiverThreshold,
  RoutedCapture,
  RoutedDeck,
} from "../../src/simulation"
import { receiverThreshold } from "../../src/simulation"
import { readInlineIbis } from "../channel-inspector/ibis-panel"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"
import { embeddedModels, modelPins } from "./model/ibis"
import { netRoles, tracePorts } from "./model/net-roles"
import { stimulusRadius } from "./model/stimulus"

export const stageCount = routedStages.length

export interface LogEntry {
  stage: string
  message: string
  level: "Info" | "OK" | "Warning" | "Error"
  time: number
  targets?: string[]
}

export interface ProbeChannel {
  name: string
  rateBps: number
  offsetMs: number
  driver: SourcePortId
  isDriver: boolean
  nominalHigh?: number
}

export interface SimulationRun {
  id: number
  timestamp: number
  name: string
  simulationId: string
  compiled: RoutedDeck
  capture: RoutedCapture
  probes: Record<string, ProbeChannel>
  threshold?: ReceiverThreshold
}

interface LocalSolverState {
  available: boolean
  version?: string
}

/** Check the loopback solver service without contacting model asset URLs. */
export async function localSolverStatus(): Promise<LocalSolverState> {
  const response = await fetch("/api/solvers")
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "Start the local Vite solver server and make ngspice available on PATH.",
    )
  const status = (await response.json()) as { ngspice: LocalSolverState }
  return status.ngspice
}

interface RunProblem {
  circuitJson: CircuitJson
  ibisSources: IbisSources
  disabledAggressorPorts: SourcePortId[]
}

/** Isolate the active simulation and extract embedded bytes into the solver's asset dictionary. */
function localProblem({
  input,
  simulation,
}: {
  input: InspectorInput
  simulation: ChannelSimulation
}): RunProblem {
  const simulationId = simulation.simulation_pcb_transient_channel_simulation_id
  const ibisSources: IbisSources = Object.create(null)
  const circuitJson = input.circuit.flatMap((record): CircuitJson => {
    if (
      (record.type === "simulation_pcb_transient_channel_simulation" ||
        record.type === "simulation_pcb_driver_receiver_channel" ||
        record.type === "simulation_eye_diagram") &&
      record.simulation_pcb_transient_channel_simulation_id !== simulationId
    )
      return []
    if (record.type !== "simulation_ibis_model") return [record]
    const asset = record.ibis_model_asset
    const text = readInlineIbis(asset.url)
    if (text === undefined) return [record]
    const path = asset.project_relative_path
    if (ibisSources[path] !== undefined && ibisSources[path] !== text)
      throw new Error(`Multiple embedded sources share ${path}.`)
    ibisSources[path] = text
    return [{ ...record, ibis_model_asset: { ...asset, url: path } }]
  })
  const db = cju([...input.circuit])
  const disabledAggressorPorts = new Set<SourcePortId>()
  for (const [traceId, role] of Object.entries(netRoles(simulation))) {
    if (role !== "excluded") continue
    const trace = db.pcb_trace.get(traceId)
    if (!trace) throw new Error(`Excluded copper ${traceId} no longer exists.`)
    for (const port of tracePorts({ circuit: input.circuit, trace }))
      disabledAggressorPorts.add(port)
  }
  return {
    circuitJson,
    ibisSources,
    disabledAggressorPorts: [...disabledAggressorPorts],
  }
}

/** An aggressor and its drive state as lowered by channel simulation planning. */
export interface PlannedAggressor {
  port: SourcePortId
  enabled: boolean
}

/** Read the same planned aggressor states that the simulation will use. */
export function plannedAggressors({
  input,
  simulation,
}: {
  input: InspectorInput
  simulation: ChannelSimulation
}): PlannedAggressor[] {
  const planner = new TransientChannelSimulationPlanSolver({
    ...localProblem({ input, simulation }),
    nearbyGapMm: stimulusRadius({
      simulation,
      defaultMm: input.distanceMm,
    }),
    captureDrivers: true,
  })
  planner.solve()
  if (planner.failed)
    throw new Error(
      planner.error ?? "Transient channel simulation planning failed.",
    )
  const [plan] = planner.getOutput().value
  const db = cju([...input.circuit])
  const declaredDrivers = new Set(
    db.simulation_pcb_driver_receiver_channel
      .list({
        simulation_pcb_transient_channel_simulation_id:
          simulation.simulation_pcb_transient_channel_simulation_id,
      })
      .flatMap(({ driver }) => endpointPorts(driver)),
  )
  return plan.bindings.controls[
    plan.simulationPcbTransientChannelSimulationId
  ].states.flatMap((state) => {
    if (!state.is_output || declaredDrivers.has(state.source_port_id)) return []
    return [
      { port: state.source_port_id, enabled: state.is_output_enabled === true },
    ]
  })
}

/** Map each raw probe to its channel timing and physical driver. */
function capturedChannels({
  circuit,
  simulation,
}: {
  circuit: CircuitJson
  simulation: ChannelSimulation
}): Record<string, ProbeChannel> {
  const db = cju([...circuit])
  const channels = db.simulation_pcb_driver_receiver_channel.list({
    simulation_pcb_transient_channel_simulation_id:
      simulation.simulation_pcb_transient_channel_simulation_id,
  })
  const pins = modelPins({ circuit, models: embeddedModels(circuit) })
  return Object.fromEntries(
    channels.flatMap((channel) => {
      const [driver] = endpointPorts(channel.driver)
      const pin = pins.find(({ port }) => port === driver)
      let nominalHigh: number | undefined
      if (pin?.name && pin.model.document?.modelNames.includes(pin.name)) {
        const buffer = pin.model.document.getBuffer(pin.name)
        nominalHigh =
          buffer.voltage?.[0] ?? buffer.pullupReference?.[0] ?? undefined
      }
      return [...channel.receivers, channel.driver].map(
        (_, index): [string, ProbeChannel] => [
          `${channel.name}_${index}`,
          {
            name: channel.name,
            rateBps: channel.bit_rate_bps,
            offsetMs: channel.offset_ms,
            driver,
            isDriver: index === channel.receivers.length,
            nominalHigh,
          },
        ],
      )
    }),
  )
}

/** A completed-stage count and the stage currently being announced. */
export interface StageProgress {
  completed: number
  stage: string
}

interface RunOptions {
  input: InspectorInput
  simulation: ChannelSimulation
  signal: AbortSignal
  log: (row: Omit<LogEntry, "time">) => void
  progress: (progress: StageProgress) => void
}

/** Step through all real routed stages, yielding to Chrome between batches. */
export async function runLocalSimulation({
  input,
  simulation,
  signal,
  log,
  progress,
}: RunOptions): Promise<Omit<SimulationRun, "id" | "timestamp">> {
  let stage = "Setup"
  try {
    const status = await localSolverStatus()
    if (!status.available)
      throw new Error("ngspice was not found on the local server PATH.")
    log({
      stage,
      level: "Info",
      message: status.version ?? "Local ngspice available",
    })
    const db = cju([...input.circuit])
    for (const issue of db.pcb_trace_error.list()) {
      log({
        stage: "Board",
        level: issue.is_fatal ? "Error" : "Warning",
        message: issue.message,
        targets: [
          issue.pcb_trace_id,
          ...issue.pcb_port_ids.flatMap((id) => {
            const port = db.pcb_port.get(id)?.source_port_id
            return port ? [port] : []
          }),
        ],
      })
    }
    const problem = localProblem({ input, simulation })
    const solver = new RoutedPipelineSolver({
      input: {
        ...problem,
        captureDrivers: true,
        nearbyGapMm: stimulusRadius({
          simulation,
          defaultMm: input.distanceMm,
        }),
      },
      context: {
        runSolver: createHttpSolver({ signal }),
        progress: (message) => log({ stage, level: "Info", message }),
      },
    })
    let budget = performance.now() + 16
    for (const [index, { solverName }] of routedStages.entries()) {
      stage = solverName
      const started = performance.now()
      progress({ completed: index, stage })
      log({ stage, level: "Info", message: "Started" })
      while (!solver.solved && solver.currentPipelineStageIndex <= index) {
        signal.throwIfAborted()
        if (performance.now() >= budget) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          budget = performance.now() + 16
        }
        await solver.stepAsync()
        if (solver.failed) throw new Error(solver.error ?? `${stage} failed.`)
      }
      progress({ completed: index + 1, stage })
      log({
        stage,
        level: "OK",
        message: `Completed in ${Math.round(performance.now() - started)} ms`,
      })
    }
    if (!solver.solved) await solver.solveAsync()

    const [result] = solver.getOutput().channelSimulations
    if (!result) throw new Error("The selected simulation produced no capture.")
    for (const plan of solver.stageOutput(
      "TransientChannelSimulationPlanSolver",
    ).value)
      for (const warning of plan.warnings)
        log({ stage: "Channel plan", level: "Warning", message: warning })
    const { models, receiverPaths } = solver.stageOutput("ChannelNetlistSolver")
      .value[0]
    log({
      stage: "Capture",
      level: "OK",
      message: `${result.capture.timestampsSeconds.length.toLocaleString()} samples · ${result.capture.probes.length} probes`,
    })
    return {
      name: result.name,
      simulationId: result.id,
      capture: result.capture,
      compiled: result.compiled,
      probes: capturedChannels({ circuit: input.circuit, simulation }),
      threshold: receiverThreshold({
        ibisSources: problem.ibisSources,
        models,
        receivers: new Set(
          receiverPaths.map(({ toSourcePortId }) => toSourcePortId),
        ),
      }),
    }
  } catch (cause) {
    const message = signal.aborted
      ? "Stopped by the user."
      : (cause as Error).message
    log({
      stage,
      level: signal.aborted ? "Warning" : "Error",
      message,
      targets:
        cause instanceof Diagnostic
          ? cause.subjects.map(({ id }) => id)
          : undefined,
    })
    throw cause
  }
}

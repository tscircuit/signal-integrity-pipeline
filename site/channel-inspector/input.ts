import {
  type CircuitJson,
  type SimulationPcbTransientChannelSimulation,
  validateCircuitRecords,
} from "../../src/board"
import {
  listChannelSimulations,
  validateNearbyGapMm,
} from "../../src/pipeline/signals"
import { type InspectorBoard, inspectorBoard } from "./geometry"
import { isInlineIbis } from "./ibis-panel"

export type ChannelSimulation = SimulationPcbTransientChannelSimulation

/** A loaded board and the channel simulations available for inspection. */
export interface InspectorInput {
  name: string
  circuit: CircuitJson
  simulations: ChannelSimulation[]
  board: InspectorBoard
  distanceMm: number
}

export const sampleNames = {
  default: "Parallel bus sample",
  ddr: "DDR3 board",
} as const
export type InspectorSample = keyof typeof sampleNames

/** The local server has no readable DDR3 sample. */
export class DdrBoardUnavailable extends Error {}

/** Validate the standard records while retaining IBIS text embedded as a data URL. */
function parseCircuit(text: string): CircuitJson {
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value))
    throw new Error("Expected a Circuit JSON record array.")
  validateCircuitRecords(
    value.map((record) => {
      const asset = record?.ibis_model_asset
      if (
        record?.type !== "simulation_ibis_model" ||
        typeof asset?.url !== "string" ||
        !isInlineIbis(asset.url)
      )
        return record
      return {
        ...record,
        ibis_model_asset: { ...asset, url: asset.project_relative_path },
      }
    }),
  )
  return value as CircuitJson
}

/** Read the local board with download progress and let the browser decode the stream. */
async function readDdrBoard({
  signal,
  onStatus,
}: {
  signal: AbortSignal
  onStatus: (status: string) => void
}): Promise<string> {
  const response = await fetch("/api/local-boards/ddr3", { signal })
  if (response.status === 404) {
    const { error } = (await response.json()) as { error: string }
    throw new DdrBoardUnavailable(error)
  }
  if (!response.ok || !response.body)
    throw new Error(
      `Could not read the local DDR3 board (HTTP ${response.status}).`,
    )
  const size = Number(response.headers.get("content-length"))
  let received = 0
  let percent = 0
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        if (size > 0) {
          const next = Math.floor((100 * received) / size)
          if (next > percent) {
            percent = next
            onStatus(`Loading DDR3 board… ${percent}%`)
          }
        }
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(stream).text()
}

/** Read a local Circuit JSON file or one of the Workbench samples. */
export async function loadInput({
  source,
  signal,
  onStatus,
}: {
  source: File | InspectorSample
  signal: AbortSignal
  onStatus: (status: string) => void
}): Promise<InspectorInput> {
  let circuit: CircuitJson
  let name: string
  let distanceMm = validateNearbyGapMm()
  if (typeof source !== "string") {
    if (!source.name.toLowerCase().endsWith(".json"))
      throw new Error("Choose a .json Circuit JSON file.")
    circuit = parseCircuit(await source.text())
    name = source.name
  } else if (source === "ddr") {
    onStatus("Loading DDR3 board…")
    const physicalRecords = parseCircuit(
      await readDdrBoard({ signal, onStatus }),
    )
    onStatus("Preparing DDR3 address and command signals…")
    const { prepareDdrSample } = await import("./ddr-sample")
    circuit = await prepareDdrSample({ physicalRecords, signal })
    name = sampleNames.ddr
  } else {
    const sample = await import("./sample")
    circuit = await sample.loadInspectorSample()
    name = sampleNames.default
    distanceMm = sample.sampleScopeDistanceMm
  }
  const simulations = listChannelSimulations(circuit)
  if (simulations.length === 0)
    throw new Error("Circuit JSON has no transient channel simulations.")
  return {
    name,
    circuit,
    simulations,
    board: inspectorBoard(circuit),
    distanceMm,
  }
}

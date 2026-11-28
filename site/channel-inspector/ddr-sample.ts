import { withDdr3Signals } from "../../examples/routed/ddr3-signals"
import type { CircuitJson, SimulationIbisModel } from "../../src/board"

/** Attach an available vendor model in memory for the Workbench's IBIS tools. */
async function withLocalDdrModel({
  model,
  signal,
}: {
  model: SimulationIbisModel
  signal: AbortSignal
}): Promise<SimulationIbisModel> {
  const asset = model.ibis_model_asset
  const file = asset.project_relative_path.split("/").at(-1)!
  const response = await fetch(
    `/api/local-assets/${encodeURIComponent(file)}`,
    {
      signal,
    },
  )
  if (response.status === 404) return model
  if (!response.ok)
    throw new Error(`Could not read ${file} (HTTP ${response.status}).`)
  const { text } = (await response.json()) as { text: string }
  return {
    ...model,
    ibis_model_asset: {
      ...asset,
      url: `data:text/plain,${encodeURIComponent(text)}`,
    },
  }
}

/** Render the address/command declarations for the physical DDR3 sample. */
export async function prepareDdrSample({
  physicalRecords,
  signal,
}: {
  physicalRecords: CircuitJson
  signal: AbortSignal
}): Promise<CircuitJson> {
  if (
    physicalRecords.some(
      (record) => record.type === "simulation_pcb_transient_channel_simulation",
    )
  )
    return physicalRecords

  const circuit = await withDdr3Signals({
    physicalRecords,
    options: { channelSimulation: "DDR3_ADDR_CMD" },
  })
  return Promise.all(
    circuit.map((record) => {
      if (record.type === "simulation_ibis_model")
        return withLocalDdrModel({ model: record, signal })
      return record
    }),
  )
}

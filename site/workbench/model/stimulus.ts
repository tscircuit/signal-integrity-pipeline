import { cju } from "@tscircuit/circuit-json-util"
import type {
  CircuitJson,
  SimulationPcbDriverReceiverChannel,
  SimulationPcbTransientChannelSimulation,
} from "../../../src/board"
import type { Snapshot } from "../../../src/kernel"
import {
  channelSimulationDurationSeconds,
  signalBits,
} from "../../../src/pipeline/signal-controls"
import { validateNearbyGapMm } from "../../../src/pipeline/signals"
import { prbsPatterns } from "../../../src/pipeline/timing"

export type ChannelEdit = Pick<
  SimulationPcbDriverReceiverChannel,
  "pattern" | "bit_rate_bps" | "offset_ms" | "seed" | "driver_disabled"
>
type TransientWithRadius = SimulationPcbTransientChannelSimulation & {
  workbench_scope_distance_mm?: number
}

/** The editable simulation-wide controls and optional individual channels. */
export interface StimulusEdit {
  name?: string
  rateBps: number
  durationMs?: number
  radiusMm: number
  aggressorPattern?: string
  aggressorsDisabled: boolean
  channels: Record<string, Partial<ChannelEdit>>
}

/** Prefer the selected simulation's stored radius when the design supplies it. */
export function stimulusRadius({
  simulation,
  defaultMm,
}: {
  simulation?: SimulationPcbTransientChannelSimulation
  defaultMm: number
}): number {
  return (
    (simulation as Snapshot<TransientWithRadius> | undefined)
      ?.workbench_scope_distance_mm ?? defaultMm
  )
}

/** Store the effective radius with an exported simulation so reopening preserves its scope. */
export function withStimulusRadius({
  simulation,
  defaultMm,
}: {
  simulation: SimulationPcbTransientChannelSimulation
  defaultMm: number
}): TransientWithRadius {
  return {
    ...simulation,
    workbench_scope_distance_mm: stimulusRadius({ simulation, defaultMm }),
  }
}

/** Apply timing and stimulus edits immutably using the pipeline's signal validators. */
export function editStimulus({
  circuit,
  id,
  edit,
}: {
  circuit: CircuitJson
  id: string
  edit: StimulusEdit
}): CircuitJson {
  const db = cju([...circuit])
  const current = db.simulation_pcb_transient_channel_simulation.get(id)
  if (!current) throw new Error("Choose a transient simulation.")
  if (!Number.isFinite(edit.rateBps) || edit.rateBps <= 0)
    throw new Error("Simulation bit rate must be positive.")
  const next: TransientWithRadius = {
    ...current,
    name: edit.name?.trim() || undefined,
    bit_rate_bps: edit.rateBps,
    duration_ms: edit.durationMs,
    aggressor_disabled: edit.aggressorsDisabled,
    aggressor_pattern: edit.aggressorPattern?.trim() || undefined,
    workbench_scope_distance_mm: validateNearbyGapMm(edit.radiusMm),
  }
  if (
    !next.name &&
    db.simulation_pcb_transient_channel_simulation.list().length > 1
  )
    throw new Error(
      "Name this simulation to distinguish it from the other simulations.",
    )
  const updated = circuit.map((record): CircuitJson[number] => {
    if (
      record.type === "simulation_pcb_transient_channel_simulation" &&
      record.simulation_pcb_transient_channel_simulation_id === id
    )
      return next
    if (
      record.type !== "simulation_pcb_driver_receiver_channel" ||
      record.simulation_pcb_transient_channel_simulation_id !== id
    )
      return record
    const channel = {
      ...record,
      ...edit.channels[record.simulation_pcb_driver_receiver_channel_id],
    }
    channel.pattern = channel.pattern.trim().toLowerCase()
    if (prbsPatterns.has(channel.pattern) && channel.seed === undefined)
      channel.seed = 1
    if (!Number.isFinite(channel.bit_rate_bps) || channel.bit_rate_bps <= 0)
      throw new Error(`${channel.name}: bit rate must be positive.`)
    if (!Number.isFinite(channel.offset_ms) || channel.offset_ms < 0)
      throw new Error(`${channel.name}: offset must be nonnegative.`)
    return channel
  })
  const channels = cju([
    ...updated,
  ]).simulation_pcb_driver_receiver_channel.list({
    simulation_pcb_transient_channel_simulation_id: id,
  })
  if (channels.length === 0)
    throw new Error("Assign a victim channel before editing its stimulus.")
  const durationSeconds = channelSimulationDurationSeconds({
    channelSimulation: next,
    patterns: channels,
  })
  for (const signal of channels) signalBits({ signal, durationSeconds })
  if (next.aggressor_pattern && !next.aggressor_disabled)
    signalBits({
      signal: {
        name: "Aggressors",
        pattern: next.aggressor_pattern,
        bit_rate_bps: next.bit_rate_bps,
        offset_ms: 0,
        seed: 1,
      },
      durationSeconds,
    })
  return updated
}

/** Update the copper scope of just the active simulation. */
export function editScopeRadius({
  circuit,
  id,
  radiusMm,
}: {
  circuit: CircuitJson
  id: string
  radiusMm: number
}): CircuitJson {
  const workbench_scope_distance_mm = validateNearbyGapMm(radiusMm)
  return circuit.map((record) => {
    if (
      record.type !== "simulation_pcb_transient_channel_simulation" ||
      record.simulation_pcb_transient_channel_simulation_id !== id
    )
      return record
    return { ...record, workbench_scope_distance_mm }
  })
}

import { isQuiet, validateCircuitRecords, type SignalResult } from '../board'
import type { PreparedBlock } from './signals'
import { endpointPorts, probeEndpoints } from './signals'
import type { PreparedResult } from './result'

/** Emit only receiver/quiet-driver waveforms and total matrices of listed signal legs. */
export function signalResults(prepared: PreparedBlock, result: PreparedResult): SignalResult[] {
  const { signals } = prepared
  const run = result.experiments[0]
  const rows = run.waveform.rows
  const records: SignalResult[] = []
  for (const signal of signals) {
    const quiet = isQuiet(signal)
    const id = signal.simulation_pcb_driver_receiver_channel_id
    for (const [index, endpoint] of probeEndpoints(signal).entries()) {
      const probe = run.probes.find(probe => probe.simulationVoltageProbeId === `${id}_${index}`)
      if (!probe) throw new Error(`${signal.name}: missing native probe`)
      let idle: number | undefined
      if (quiet) idle = result.idleVoltages?.[probe.column - 1]
      if (quiet && idle === undefined) throw new Error(`Signal "${signal.name}": floating quiet victim has no undisturbed idle operating point.`)
      const waveform: Extract<SignalResult, { type: 'simulation_signal_waveform_result' }> = {
        type: 'simulation_signal_waveform_result', simulation_signal_waveform_result_id: `${id}_${index}`, simulation_pcb_driver_receiver_channel_id: id,
        source_port_id: endpointPorts(endpoint)[0],
        timestamps_ms: rows.map(row => row[0] * 1000), voltage_levels: rows.map(row => row[probe.column]),
      }
      if (idle !== undefined) waveform.idle_voltage_v = idle
      records.push(waveform)
    }
  }
  const channel = channelResult(prepared, result)
  if (channel) records.push(channel)
  validateCircuitRecords([...signals, ...records])
  return records
}

type ChannelResult = Extract<SignalResult, { type: 'simulation_pcb_transient_channel_result' }>

/** Select listed legs and sum their matrix rows and columns at each frequency. */
function channelResult(prepared: PreparedBlock, result: PreparedResult): ChannelResult | undefined {
  const { block, signals } = prepared
  const conductors: ChannelResult['conductors'] = []
  const order = result.geometry.mappings.map(mapping => {
    const signal = signals.find(signal => endpointPorts(signal.driver).some(port => prepared.topology.get(port)?.has(mapping.from)))
    if (!signal) return -1
    const port = endpointPorts(signal.driver).find(port => prepared.topology.get(port)?.has(mapping.from))!
    const index = conductors.findIndex(conductor => conductor.simulation_pcb_driver_receiver_channel_id === signal.simulation_pcb_driver_receiver_channel_id && conductor.source_port_id === port)
    if (index >= 0) return index
    conductors.push({ simulation_pcb_driver_receiver_channel_id: signal.simulation_pcb_driver_receiver_channel_id, source_port_id: port })
    return conductors.length - 1
  })
  if (!conductors.length) return
  const frequencies = [...new Set(result.matrices.map(matrix => matrix.frequencyHz))].sort((a, b) => a - b)
  return { type: 'simulation_pcb_transient_channel_result', simulation_pcb_transient_channel_result_id: block.simulation_pcb_transient_channel_simulation_id,
    simulation_pcb_transient_channel_simulation_id: block.simulation_pcb_transient_channel_simulation_id, conductors,
    matrices: frequencies.map(frequency => {
      const sections = result.matrices.filter(matrix => matrix.frequencyHz === frequency)
      const selection = { sections, order, conductors }
      return {
        frequency_hz: frequency, resistance_ohms: totalMatrix(selection, 'R'), inductance_henries: totalMatrix(selection, 'L'),
        capacitance_farads: totalMatrix(selection, 'C'), conductance_siemens: totalMatrix(selection, 'G'),
      }
    }) }
}

/** Sum section totals, preserving the section and conductor traversal order. */
function totalMatrix({ sections, order, conductors }: {
  sections: PreparedResult['matrices']
  order: number[]
  conductors: ChannelResult['conductors']
}, kind: 'R' | 'L' | 'C' | 'G'): number[][] {
  const matrix = conductors.map(() => conductors.map(() => 0))
  for (const section of sections) {
    for (const [i, row] of section[kind].entries()) for (const [j, entry] of row.entries()) {
      if (!(order[i] >= 0 && order[j] >= 0)) continue
      matrix[order[i]][order[j]] += entry
    }
  }
  return matrix
}

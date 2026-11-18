import type { FileMap } from '../kernel'
import type { PipelineResult } from '../pipeline'

/** Escape text and attributes in the standalone report. */
const html = (text: string): string => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

/** The positive pin represents a differential driver in single-probe labels. */
function driverSourcePort(driver: Extract<PipelineResult['circuitJson'][number], { type: 'simulation_pcb_driver_receiver_channel' }>['driver']): string {
  if ('source_port_id' in driver) return driver.source_port_id
  return driver.p_source_port_id
}

/** Render accepted voltage captures only; full native samples remain in the pipeline artifacts. */
export function generateReport(result: PipelineResult): FileMap {
  const panels = result.blocks.flatMap(block => block.results.flatMap(record => {
    if (record.type !== 'simulation_signal_waveform_result') return []
    const times = record.timestamps_ms
    const voltages = record.voltage_levels
    const stride = Math.max(1, Math.ceil(times.length / 4000))
    let low = Infinity
    let high = -Infinity
    for (const voltage of voltages) {
      low = Math.min(low, voltage)
      high = Math.max(high, voltage)
    }
    const span = Math.max(high - low, .1)
    const points = times.flatMap((time, index) => {
      if (index % stride && index !== times.length - 1) return []
      return [`${60 + 900 * time / block.duration_ms},${225 - 180 * (voltages[index] - low) / span}`]
    }).join(' ')
    const signal = result.circuitJson.find(source => source.type === 'simulation_pcb_driver_receiver_channel' && source.simulation_pcb_driver_receiver_channel_id === record.simulation_pcb_driver_receiver_channel_id)
    let name = record.simulation_pcb_driver_receiver_channel_id
    let end = 'far'
    if (signal?.type === 'simulation_pcb_driver_receiver_channel') {
      name = signal.name
      const { driver } = signal
      if (driverSourcePort(driver) === record.source_port_id) end = 'near'
    }
    let idle = ''
    if (record.idle_voltage_v !== undefined) idle = `<p>Undisturbed idle: ${record.idle_voltage_v} V</p>`
    return [`<section><h2>${html(block.name)} / ${html(name)} / ${end} / ${html(record.source_port_id)}</h2><svg viewBox="0 0 1000 270" role="img" aria-label="Receiver voltage over time"><path d="M60 30V225H960" fill="none" stroke="#888"/><polyline points="${points}" fill="none" stroke="#1673b8"/><text x="60" y="260">0 — ${block.duration_ms * 1000} µs</text><text x="10" y="22">${low.toPrecision(4)} — ${high.toPrecision(4)} V</text></svg>${idle}<p>${times.length} native samples; display stride ${stride}. Full samples are in the waveform artifacts.</p></section>`]
  })).join('\n')
  return { 'results.html': `<!doctype html><html lang="en"><meta charset="utf-8"><title>Transient channel captures</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px}svg{width:100%}section{margin:40px 0}</style><h1>Simulation complete</h1><main id="simulation-data">${panels}</main><pre>${html(result.limitations.join('\n'))}</pre></html>` }
}

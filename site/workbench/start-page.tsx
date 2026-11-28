import type { JSX } from "react"
import type { InspectorSample } from "../channel-inspector/input"
import { Icon } from "./icons"
import type { SimulationState } from "./simulation-state"

const solverStatus = {
  checking: "Checking ngspice availability…",
  ready: "ngspice available",
  offline: "ngspice unavailable",
  running: "ngspice is running",
} as const

/** Offer local files and sample boards in the same desktop window. */
export function StartPage({
  recent,
  openFile,
  openRecent,
  openSample,
  runner,
}: {
  recent: string[]
  openFile?: () => void
  openRecent?: (name: string) => void
  openSample?: (sample: InspectorSample) => void
  runner: Pick<SimulationState, "solver" | "version">
}): JSX.Element {
  return (
    <div className="wb-start-page">
      <button className="wb-start-open" onClick={openFile} disabled={!openFile}>
        <Icon name="open" />
        Open Circuit JSON…
      </button>
      <section>
        <h2>Samples</h2>
        <div className="wb-start-samples">
          <button
            disabled={!openSample}
            onClick={() => openSample?.("default")}
          >
            <Icon name="sample" />
            <strong>Default sample</strong>
            <span>Synthetic parallel bus</span>
          </button>
          <button disabled={!openSample} onClick={() => openSample?.("ddr")}>
            <Icon name="board" />
            <strong>DDR3 board</strong>
            <span>Local Circuit JSON</span>
          </button>
        </div>
      </section>
      <section>
        <h2>Recent files</h2>
        {recent.length === 0 && <p>No recent files.</p>}
        {recent.length > 0 && (
          <ul>
            {recent.map((name) => (
              <li key={name}>
                <button
                  disabled={!openRecent}
                  onClick={() => openRecent?.(name)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="wb-start-solver">
        <Icon name="info" />
        {solverStatus[runner.solver]}
        {runner.version && runner.solver === "ready" && ` (${runner.version})`}
      </p>
    </div>
  )
}

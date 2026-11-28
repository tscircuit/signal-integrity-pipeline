import { type JSX, useLayoutEffect, useRef, useState } from "react"
import { Icon } from "./icons"
import type { LogEntry } from "./local-run"
import "./simulation.css"

const filters = ["All", "Errors", "Warnings"] as const
type Filter = (typeof filters)[number]
const logIcons = {
  Info: "info",
  OK: "ok",
  Warning: "warning",
  Error: "error",
} as const

/** Report each real pipeline stage and show board locations when the diagnostic identifies them. */
export function SimulationLog({
  entries,
  clear,
  targets,
  showOnBoard,
  showDeck,
}: {
  entries: LogEntry[]
  clear: () => void
  targets: (entry: LogEntry) => string | undefined
  showOnBoard: (target: string) => void
  showDeck?: () => void
}): JSX.Element {
  const [filter, setFilter] = useState<Filter>("All")
  const [message, setMessage] = useState("")
  const errorCount = entries.filter(({ level }) => level === "Error").length
  const warningCount = entries.filter(({ level }) => level === "Warning").length
  const visible = entries.filter(
    ({ level }) =>
      filter === "All" ||
      (filter === "Errors" && level === "Error") ||
      (filter === "Warnings" && level === "Warning"),
  )
  const scroll = useRef<HTMLDivElement>(null)
  const newest = visible.at(-1)
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [newest, filter])
  return (
    <div className="wb-editor wb-log">
      <div className="wb-tool-row">
        {filters.map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value}
            {value === "Errors" && ` (${errorCount})`}
            {value === "Warnings" && ` (${warningCount})`}
          </button>
        ))}
        <span className="wb-separator" />
        <button onClick={clear} disabled={!entries.length}>
          Clear
        </button>
        <button
          disabled={!entries.length}
          onClick={() =>
            void navigator.clipboard
              .writeText(
                visible
                  .map(
                    ({ time, level, stage, message }) =>
                      `${new Date(time).toLocaleTimeString()}\t${level}\t${stage}\t${message}`,
                  )
                  .join("\n"),
              )
              .then(
                () => setMessage("Log copied"),
                (error: Error) => setMessage(error.message),
              )
          }
        >
          Copy
        </button>
        <button disabled={!showDeck} onClick={showDeck}>
          SPICE Deck…
        </button>
        <output>{message}</output>
      </div>
      <div className="wb-editor-scroll" ref={scroll}>
        <table className="wb-grid wb-log-grid">
          <thead>
            <tr>
              <th>Time</th>
              <th>Lvl</th>
              <th>Stage</th>
              <th>Message</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entry, index) => {
              const target =
                entry.level === "Error" ? targets(entry) : undefined
              const key = `${entry.time}:${entry.stage}:${entry.level}:${entry.message}`
              return (
                <tr key={index + key} data-level={entry.level}>
                  <td>{new Date(entry.time).toLocaleTimeString("en-GB")}</td>
                  <td title={entry.level}>
                    <Icon name={logIcons[entry.level]} />
                  </td>
                  <td>{entry.stage}</td>
                  <td>
                    {entry.message.length > 250 ? (
                      <details>
                        <summary>{entry.message.slice(0, 180)}…</summary>
                        {entry.message}
                      </details>
                    ) : (
                      entry.message
                    )}
                  </td>
                  <td>
                    {target && (
                      <button onClick={() => showOnBoard(target)}>
                        Show on Board
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visible.length && (
          <p className="wb-placeholder">No matching log entries.</p>
        )}
      </div>
    </div>
  )
}

const solverLabels = {
  checking: "Checking solver",
  ready: "ngspice Ready",
  offline: "Solver Offline",
  running: "Simulating…",
}

/** Native-looking status indicator and six stage segments. */
export function SolverIndicator({
  solver,
  version,
  completed,
}: {
  solver: keyof typeof solverLabels
  version?: string
  completed: number
}): JSX.Element {
  return (
    <>
      <span
        className="wb-solver-indicator"
        data-solver={solver}
        title={version}
      >
        <i />
        {solverLabels[solver]}
      </span>
      <div
        className="wb-progress"
        role="progressbar"
        aria-label="Simulation progress"
        aria-valuemin={0}
        aria-valuemax={6}
        aria-valuenow={completed}
      >
        {[1, 2, 3, 4, 5, 6].map((stage) => (
          <i key={stage} data-complete={stage <= completed} />
        ))}
      </div>
    </>
  )
}

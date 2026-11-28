import type { JSX } from "react"
import type { BoardInteraction } from "../channel-inspector/board-3d"
import type { InspectorFeature } from "../channel-inspector/geometry"
import { boardCoordinates } from "./board-viewer"
import { CaptionIcon, Icon } from "./icons"
import { stageCount } from "./local-run"
import { SolverIndicator } from "./simulation-log"
import type { useSimulation } from "./simulation-state"

/** The classic application caption and local document controls. */
export function DesktopTitle({
  board,
  simulation,
  dirty,
  toggleDocks,
  toggleFullscreen,
  close,
}: {
  board?: string
  simulation?: string
  dirty: boolean
  toggleDocks: () => void
  toggleFullscreen: () => void
  close?: () => void
}): JSX.Element {
  return (
    <header className="wb-title">
      <Icon name="app" />
      <h1>
        tscircuit SI Workbench - [
        {board ? `${board} | ${simulation ?? "Simulation"}` : "No Board Loaded"}
        ]{dirty && "*"}
      </h1>
      <div className="wb-title-buttons wb-child-title">
        <button
          title="Toggle docked panels"
          aria-label="Toggle docked panels"
          onClick={toggleDocks}
        >
          <CaptionIcon name="minimize" />
        </button>
        <button
          title="Toggle full screen"
          aria-label="Toggle full screen"
          onClick={toggleFullscreen}
        >
          <CaptionIcon name="maximize" />
        </button>
        <button
          title="Close board"
          aria-label="Close board"
          disabled={!close}
          onClick={close}
        >
          <CaptionIcon name="close" />
        </button>
      </div>
    </header>
  )
}

/** Display board coordinates, selection, solver health, and the current progress stage. */
export function DesktopStatus({
  runner,
  status,
  cursor,
  picked,
  pickedLabel,
  hovered,
}: {
  runner: ReturnType<typeof useSimulation>
  status: string
  cursor?: Parameters<NonNullable<BoardInteraction["onCursor"]>>[0]
  picked?: InspectorFeature
  pickedLabel?: string
  hovered?: InspectorFeature
}): JSX.Element {
  let summary = status
  if (runner.solver === "running")
    summary = `Stage ${Math.min(stageCount, runner.completed + 1)}/${stageCount} · ${runner.stage}`
  else if (status === "Ready" && runner.summary) summary = runner.summary
  const layer = (hovered ?? picked)?.layers.join(", ") || "—"
  return (
    <footer className="wb-status">
      <span role="status" title={summary}>
        {summary}
      </span>
      <span className="wb-status-coords">{boardCoordinates(cursor)}</span>
      <span title={layer}>Layer {layer}</span>
      <span title={pickedLabel}>{pickedLabel ?? "No selection"}</span>
      <SolverIndicator
        solver={runner.solver}
        version={runner.version}
        completed={runner.completed}
      />
      <i className="wb-status-grip" aria-hidden="true" />
    </footer>
  )
}

import { type JSX, useState } from "react"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"
import { AssignModels, type IbisFocus } from "./assign-models"
import { type Menu, Modal } from "./chrome"
import type { useDesignHistory } from "./design-history"
import { AboutDialog, DeckDialog } from "./info-dialogs"
import type { SimulationRun } from "./local-run"
import { menuShortcuts } from "./menus"
import { editScopeRadius, stimulusRadius } from "./model/stimulus"
import { StimulusDialog } from "./stimulus-dialog"

export type ActiveDialog =
  | { kind: "assign"; port?: string; modelId?: string }
  | { kind: "ddr-unavailable"; message: string }
  | {
      kind:
        | "stimulus"
        | "deck"
        | "about"
        | "discard"
        | "radius"
        | "shortcuts"
        | "guide"
    }

/** Edit the selected simulation's extraction scope without changing timing. */
function ScopeRadiusDialog({
  input,
  simulation,
  close,
  apply,
}: {
  input: InspectorInput
  simulation: ChannelSimulation
  close: () => void
  apply: ReturnType<typeof useDesignHistory>["edit"]
}): JSX.Element {
  const [radius, setRadius] = useState(
    stimulusRadius({ simulation, defaultMm: input.distanceMm }),
  )
  const [error, setError] = useState<string>()
  return (
    <Modal
      title="Copper Scope Radius"
      close={close}
      apply={() => {
        try {
          apply(
            editScopeRadius({
              circuit: input.circuit,
              id: simulation.simulation_pcb_transient_channel_simulation_id,
              radiusMm: radius,
            }),
          )
          setError(undefined)
          return true
        } catch (cause) {
          setError((cause as Error).message)
          return false
        }
      }}
    >
      <label>
        Radius (mm){" "}
        <input
          type="number"
          min="0.001"
          step="any"
          value={radius || ""}
          onChange={(event) => setRadius(event.target.valueAsNumber)}
        />
      </label>
      {error && (
        <p role="alert" className="wb-inline-error">
          {error}
        </p>
      )}
    </Modal>
  )
}

/** Render the active desktop dialog over the workbench. */
export function WorkbenchDialogs({
  dialog,
  input,
  simulation,
  retained,
  apply,
  close,
  closeBoard,
  showCurves,
  lastRun,
  version,
  menus,
}: {
  dialog?: ActiveDialog
  input?: InspectorInput
  simulation?: ChannelSimulation
  retained: ReadonlySet<string>
  apply: ReturnType<typeof useDesignHistory>["edit"]
  close: () => void
  closeBoard: () => void
  showCurves: (focus: IbisFocus) => void
  lastRun?: SimulationRun
  version?: string
  menus: Menu[]
}): JSX.Element | null {
  if (dialog?.kind === "ddr-unavailable")
    return (
      <Modal title="DDR3 board unavailable" close={close} icon="warning">
        <div className="wb-local-board-message">
          <p>{dialog.message}</p>
          <p>Check that the sample board exists in your checkout.</p>
        </div>
      </Modal>
    )
  if (dialog?.kind === "assign" && input)
    return (
      <AssignModels
        circuit={input.circuit}
        port={dialog.port}
        componentId={dialog.modelId}
        retained={retained}
        apply={apply}
        close={close}
        showCurves={showCurves}
      />
    )
  if (dialog?.kind === "stimulus" && input && simulation)
    return (
      <StimulusDialog
        input={input}
        simulation={simulation}
        apply={apply}
        close={close}
      />
    )
  if (dialog?.kind === "radius" && input && simulation)
    return (
      <ScopeRadiusDialog
        input={input}
        simulation={simulation}
        close={close}
        apply={apply}
      />
    )
  if (dialog?.kind === "shortcuts")
    return (
      <Modal title="Keyboard Shortcuts" close={close} closeLabel="Close">
        <table className="wb-grid">
          <thead>
            <tr>
              <th>Command</th>
              <th>Shortcut</th>
            </tr>
          </thead>
          <tbody>
            {menuShortcuts(menus).map(({ label, shortcut }) => (
              <tr key={label}>
                <td>{label}</td>
                <td>
                  <kbd>{shortcut}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    )
  if (dialog?.kind === "guide")
    return (
      <Modal title="SI Workflow Quick Guide" close={close} closeLabel="Close">
        <ol>
          <li>Open a Circuit JSON board or the parallel-bus sample.</li>
          <li>
            Inspect the victim and nearby copper in Board Viewer. Check stackup
            and embedded IBIS assignments.
          </li>
          <li>
            Set timing, channel patterns, and aggressor drive in Stimulus &amp;
            Aggressors.
          </li>
          <li>
            Run ngspice with F5. Use Simulation Log to locate diagnostics on the
            board.
          </li>
          <li>
            Inspect Waveforms, Eye Diagram, and Measurements. Export a CSV or
            PNG from File.
          </li>
        </ol>
      </Modal>
    )
  if (dialog?.kind === "deck" && lastRun)
    return <DeckDialog deck={lastRun.compiled.deck} close={close} />
  if (dialog?.kind === "about")
    return <AboutDialog version={version} close={close} />
  if (dialog?.kind === "discard")
    return (
      <Modal title="Close Board" close={close} confirm={closeBoard}>
        <p>Discard the unsaved changes to {input?.name}?</p>
      </Modal>
    )
  return null
}

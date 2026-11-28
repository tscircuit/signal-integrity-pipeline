import type { IbisCorner } from "@tscircuit/ibis-to-spice"
import { type JSX, useMemo, useState } from "react"
import type { CircuitJson } from "../../src/board"
import { Modal } from "./chrome"
import {
  assignIbisModel,
  displayBuffer,
  displayDirection,
  embeddedModels,
  modelPins,
} from "./model/ibis"
import { corners, directions } from "./model/ibis-text"

export interface IbisFocus {
  modelId: string
  buffer?: string
}

interface Assignment {
  name: string
  direction: string
  corner: IbisCorner
}

/** Filter and assign the component/pin model binding used by the routed solver. */
export function AssignModels({
  circuit,
  port,
  componentId,
  retained,
  apply,
  close,
  showCurves,
}: {
  circuit: CircuitJson
  port?: string
  componentId?: string
  retained: ReadonlySet<string>
  apply: (circuit: CircuitJson) => void
  close: () => void
  showCurves: (focus: IbisFocus) => void
}): JSX.Element {
  const models = useMemo(() => embeddedModels(circuit), [circuit])
  const pins = useMemo(() => modelPins({ circuit, models }), [circuit, models])
  const [component, setComponent] = useState(componentId ?? "")
  const [filter, setFilter] = useState("")
  const [onlyRetained, setOnlyRetained] = useState(false)
  const [pinId, setPin] = useState(
    () => pins.find((pin) => pin.port === port)?.id,
  )
  const [draft, setDraft] = useState<Assignment>()
  const [error, setError] = useState<string>()
  const visible = pins.filter(
    (pin) =>
      (!component || pin.model.record.simulation_ibis_model_id === component) &&
      (!onlyRetained || retained.has(pin.port)) &&
      `${pin.label} ${pin.pin} ${pin.name ?? ""}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  )
  const pin =
    visible.find(({ id }) => id === pinId) ??
    visible.find((item) => item.signal) ??
    visible[0]
  const assignment: Assignment = draft ?? {
    name: pin?.name?.split("__wb_")[0] ?? "",
    direction: pin?.direction ?? "",
    corner: pin?.corner ?? "typical",
  }
  const editable = pin?.signal && pin.model.document !== undefined
  return (
    <Modal
      title="Assign IBIS Models"
      close={close}
      apply={() => {
        if (!draft) return true
        if (!pin) return false
        try {
          apply(assignIbisModel({ circuit, pin, ...assignment }))
          setDraft(undefined)
          setError(undefined)
          return true
        } catch (cause) {
          setError((cause as Error).message)
          return false
        }
      }}
    >
      <div className="wb-assignment">
        <div className="wb-tool-row">
          <label>
            Component{" "}
            <select
              value={component}
              onChange={(event) => {
                setComponent(event.target.value)
                setDraft(undefined)
              }}
            >
              <option value="">All</option>
              {models.map((model) => (
                <option
                  key={model.record.simulation_ibis_model_id}
                  value={model.record.simulation_ibis_model_id}
                >
                  {model.component}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter{" "}
            <input
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value)
                setDraft(undefined)
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={onlyRetained}
              onChange={(event) => {
                setOnlyRetained(event.target.checked)
                setDraft(undefined)
              }}
            />{" "}
            Retained signal nets only
          </label>
        </div>
        <div className="wb-assignment-list">
          <table className="wb-grid wb-editor-grid">
            <thead>
              <tr>
                {[
                  "Comp",
                  "Pin",
                  "Port / Net",
                  "Assigned model",
                  "Corner",
                  "Type",
                  "Scope",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  aria-selected={pin?.id === row.id}
                  onClick={() => {
                    setPin(row.id)
                    setDraft(undefined)
                    setError(undefined)
                  }}
                >
                  <td>{row.model.component}</td>
                  <td>{row.pin}</td>
                  <td>{row.label}</td>
                  <td>{displayBuffer(row.name)}</td>
                  <td>{row.corner}</td>
                  <td>{displayDirection(row.direction)}</td>
                  <td>
                    {retained.has(row.port) ? "Retained" : "Outside scope"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <p className="wb-placeholder">No matching IBIS pins.</p>
          )}
        </div>
        <fieldset className="wb-fields wb-assignment-fields">
          <legend>Selected pin assignment</legend>
          <label>
            Model{" "}
            <select
              disabled={!editable}
              value={assignment.name}
              onChange={(event) => {
                const name = event.target.value
                setDraft({
                  ...assignment,
                  name,
                  direction: pin?.model.document?.getBuffer(name).type ?? "",
                })
              }}
            >
              {!assignment.name && <option value="">Select a model</option>}
              {pin?.model.document?.modelNames
                .filter((name) => !name.includes("__wb_"))
                .map((name) => (
                  <option key={name}>{name}</option>
                ))}
            </select>
          </label>
          <label>
            Corner{" "}
            <select
              disabled={!editable}
              value={assignment.corner}
              onChange={(event) =>
                setDraft({
                  ...assignment,
                  corner: event.target.value as IbisCorner,
                })
              }
            >
              {corners.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Direction{" "}
            <select
              disabled={!editable}
              value={assignment.direction.toLowerCase()}
              onChange={(event) =>
                setDraft({
                  ...assignment,
                  direction:
                    directions.find(
                      (value) => value.toLowerCase() === event.target.value,
                    ) ?? "",
                })
              }
            >
              {!directions.some(
                (value) =>
                  value.toLowerCase() === assignment.direction.toLowerCase(),
              ) && (
                <option value={assignment.direction}>
                  {assignment.direction || "—"}
                </option>
              )}
              {directions.map((value) => (
                <option key={value} value={value.toLowerCase()}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!editable}
            onClick={() => {
              if (pin)
                showCurves({
                  modelId: pin.model.record.simulation_ibis_model_id,
                  buffer: pin.name,
                })
            }}
          >
            View Curves…
          </button>
          <button disabled title="Coming later">
            Load External .ibs…
          </button>
        </fieldset>
        {(error || pin?.model.error) && (
          <p role="alert" className="wb-inline-error">
            {error ?? pin?.model.error}
          </p>
        )}
      </div>
    </Modal>
  )
}

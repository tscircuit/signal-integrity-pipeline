import { cju } from "@tscircuit/circuit-json-util"
import { type JSX, useId, useMemo, useState } from "react"
import { type CircuitJson, endpointPorts } from "../../src/board"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"
import { Modal } from "./chrome"
import { type PlannedAggressor, plannedAggressors } from "./local-run"
import {
  displayBuffer,
  displayDirection,
  embeddedModels,
  modelPins,
} from "./model/ibis"
import { qualifiedPort } from "./model/labels"
import {
  type ChannelEdit,
  editStimulus,
  type StimulusEdit,
  stimulusRadius,
} from "./model/stimulus"

const stimulusTabs = ["Victims & Timing", "Aggressors"] as const
type StimulusTab = (typeof stimulusTabs)[number]
const nanosecondsPerMillisecond = 1e6
const bitsPerMegabit = 1e6

/** Channel planning either reports real driver states or explains why the design cannot run. */
interface AggressorPreview {
  drivers: PlannedAggressor[]
  error?: string
}

/** Admit the exact draft that OK would save. */
function previewAggressors({
  input,
  id,
  edit,
}: {
  input: InspectorInput
  id: string
  edit: StimulusEdit
}): AggressorPreview {
  try {
    const circuit = editStimulus({ circuit: input.circuit, id, edit })
    const simulation = cju([
      ...circuit,
    ]).simulation_pcb_transient_channel_simulation.get(id)!
    return {
      drivers: plannedAggressors({ input: { ...input, circuit }, simulation }),
    }
  } catch (cause) {
    return { drivers: [], error: (cause as Error).message }
  }
}

/** Update only a selected channel's fields. */
function withChannelEdit({
  values,
  id,
  patch,
}: {
  values: Record<string, Partial<ChannelEdit>>
  id: string
  patch: Partial<ChannelEdit>
}): Record<string, Partial<ChannelEdit>> {
  return { ...values, [id]: { ...values[id], ...patch } }
}

/** Edit the active simulation and its declared channel-specific driver settings. */
export function StimulusDialog({
  input,
  simulation,
  apply,
  close,
}: {
  input: InspectorInput
  simulation: ChannelSimulation
  apply: (circuit: CircuitJson) => void
  close: () => void
}): JSX.Element {
  const { circuit } = input
  const id = simulation.simulation_pcb_transient_channel_simulation_id
  const db = useMemo(() => cju([...circuit]), [circuit])
  const channels = db.simulation_pcb_driver_receiver_channel.list({
    simulation_pcb_transient_channel_simulation_id: id,
  })
  const [tab, setTab] = useState<StimulusTab>("Victims & Timing")
  const [name, setName] = useState(simulation.name ?? "")
  const [rate, setRate] = useState(simulation.bit_rate_bps / bitsPerMegabit)
  const [duration, setDuration] = useState<number | undefined>(
    simulation.duration_ms === undefined
      ? undefined
      : simulation.duration_ms * nanosecondsPerMillisecond,
  )
  const [radius, setRadius] = useState(
    stimulusRadius({ simulation, defaultMm: input.distanceMm }),
  )
  const [disabled, setDisabled] = useState(
    simulation.aggressor_disabled === true,
  )
  const [pattern, setPattern] = useState(simulation.aggressor_pattern ?? "")
  const [edits, setEdits] = useState<Record<string, Partial<ChannelEdit>>>({})
  const [error, setError] = useState<string>()
  const list = useId()
  const pins = useMemo(
    () => modelPins({ circuit, models: embeddedModels(circuit) }),
    [circuit],
  )
  const edit = useMemo<StimulusEdit>(
    () => ({
      name,
      rateBps: rate * bitsPerMegabit,
      durationMs:
        duration === undefined
          ? undefined
          : duration / nanosecondsPerMillisecond,
      radiusMm: radius,
      aggressorPattern: pattern,
      aggressorsDisabled: disabled,
      channels: edits,
    }),
    [name, rate, duration, radius, pattern, disabled, edits],
  )
  const preview = useMemo(() => {
    if (tab === "Aggressors") return previewAggressors({ input, id, edit })
  }, [tab, input, id, edit])
  return (
    <Modal
      title="Stimulus & Aggressors"
      close={close}
      apply={() => {
        try {
          apply(editStimulus({ circuit, id, edit }))
          setEdits({})
          setError(undefined)
          return true
        } catch (cause) {
          setError((cause as Error).message)
          return false
        }
      }}
    >
      <div className="wb-stimulus">
        <div className="wb-tabs" role="tablist" aria-label="Stimulus settings">
          {stimulusTabs.map((value) => (
            <button
              role="tab"
              aria-selected={value === tab}
              key={value}
              onClick={() => setTab(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="wb-tab-panel" role="tabpanel">
          <datalist id={list}>
            {["0", "1", "01", "0101", "clock", "prbs7", "prbs15", "prbs31"].map(
              (item) => (
                <option key={item} value={item} />
              ),
            )}
          </datalist>
          {tab === "Victims & Timing" && (
            <fieldset className="wb-fields wb-stimulus-timing">
              <legend>Simulation timing</legend>
              <label>
                Simulation name{" "}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Default bit rate (Mbps){" "}
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={rate || ""}
                  onChange={(event) => setRate(event.target.valueAsNumber || 0)}
                />
              </label>
              <label>
                Duration (ns){" "}
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  disabled={duration === undefined}
                  value={duration ?? ""}
                  onChange={(event) =>
                    setDuration(event.target.valueAsNumber || 0)
                  }
                />
              </label>
              <label>
                Auto duration{" "}
                <input
                  type="checkbox"
                  checked={duration === undefined}
                  onChange={(event) =>
                    setDuration(event.target.checked ? undefined : 200)
                  }
                />
              </label>
              <label>
                Copper scope radius (mm){" "}
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={radius || ""}
                  onChange={(event) =>
                    setRadius(event.target.valueAsNumber || 0)
                  }
                />
              </label>
            </fieldset>
          )}
          {tab === "Victims & Timing" && (
            <div className="wb-stimulus-list">
              <table className="wb-grid wb-editor-grid">
                <thead>
                  <tr>
                    {[
                      "Channel",
                      "Driver",
                      "Receiver",
                      "Pattern",
                      "Mbps",
                      "Offset (ns)",
                      "Seed",
                      "Disabled",
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {channels.map((channel) => {
                    const channelId =
                      channel.simulation_pcb_driver_receiver_channel_id
                    const value = { ...channel, ...edits[channelId] }
                    return (
                      <tr key={channelId}>
                        <td>{channel.name}</td>
                        <td>
                          {endpointPorts(channel.driver)
                            .map((port) => qualifiedPort({ db, port }))
                            .join("/")}
                        </td>
                        <td>
                          {channel.receivers
                            .flatMap(endpointPorts)
                            .map((port) => qualifiedPort({ db, port }))
                            .join("/")}
                        </td>
                        <td>
                          <input
                            aria-label={`${channel.name} pattern`}
                            list={list}
                            value={value.pattern}
                            onChange={(event) =>
                              setEdits((values) =>
                                withChannelEdit({
                                  values,
                                  id: channelId,
                                  patch: { pattern: event.target.value },
                                }),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${channel.name} bit rate`}
                            type="number"
                            min="0.001"
                            step="any"
                            value={value.bit_rate_bps / bitsPerMegabit || ""}
                            onChange={(event) =>
                              setEdits((values) =>
                                withChannelEdit({
                                  values,
                                  id: channelId,
                                  patch: {
                                    bit_rate_bps:
                                      event.target.valueAsNumber *
                                      bitsPerMegabit,
                                  },
                                }),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${channel.name} offset`}
                            type="number"
                            min="0"
                            step="any"
                            value={value.offset_ms * nanosecondsPerMillisecond}
                            onChange={(event) =>
                              setEdits((values) =>
                                withChannelEdit({
                                  values,
                                  id: channelId,
                                  patch: {
                                    offset_ms:
                                      event.target.valueAsNumber /
                                      nanosecondsPerMillisecond,
                                  },
                                }),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${channel.name} seed`}
                            type="number"
                            min="1"
                            step="1"
                            value={value.seed ?? ""}
                            onChange={(event) =>
                              setEdits((values) =>
                                withChannelEdit({
                                  values,
                                  id: channelId,
                                  patch: {
                                    seed:
                                      event.target.valueAsNumber || undefined,
                                  },
                                }),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Disable ${channel.name}`}
                            type="checkbox"
                            checked={value.driver_disabled === true}
                            onChange={(event) =>
                              setEdits((values) =>
                                withChannelEdit({
                                  values,
                                  id: channelId,
                                  patch: {
                                    driver_disabled: event.target.checked,
                                  },
                                }),
                              )
                            }
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tab === "Aggressors" && (
            <>
              <fieldset className="wb-fields wb-aggressor-mode">
                <legend>Aggressor drive mode</legend>
                <label>
                  <input
                    type="radio"
                    checked={!disabled}
                    onChange={() => setDisabled(false)}
                  />{" "}
                  Drive aggressors with pattern{" "}
                  <input
                    aria-label="Aggressor pattern"
                    list={list}
                    disabled={disabled}
                    value={pattern}
                    onChange={(event) => setPattern(event.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="radio"
                    checked={disabled}
                    onChange={() => setDisabled(true)}
                  />{" "}
                  Disable aggressor drivers
                </label>
              </fieldset>
              <div className="wb-stimulus-list">
                <table className="wb-grid">
                  <thead>
                    <tr>
                      <th>Detected driver</th>
                      <th>Model</th>
                      <th>Type</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview?.drivers.map(({ port, enabled }) => {
                      const pin = pins.find((item) => item.port === port)
                      return (
                        <tr key={port}>
                          <td>{qualifiedPort({ db, port })}</td>
                          <td>{displayBuffer(pin?.name)}</td>
                          <td>{displayDirection(pin?.direction)}</td>
                          <td>{enabled ? "Driven" : "High impedance"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {preview?.error && (
                <p role="alert" className="wb-inline-error">
                  {preview.error}
                </p>
              )}
              {preview && !preview.error && preview.drivers.length === 0 && (
                <p>No aggressor drivers in the planned copper scope.</p>
              )}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="wb-inline-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

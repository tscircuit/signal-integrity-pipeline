import { Fragment, type JSX } from "react"
import type { ChannelSimulation } from "../channel-inspector/input"
import { type Theme, themeIds, themes } from "./chrome"
import { Icon } from "./icons"
import { type CommandActions, toolbarGroups, workbenchCommand } from "./menus"

/** Render dense desktop tool groups with visible simulation and theme selectors. */
export function Toolbar({
  actions,
  simulations,
  index,
  selectSimulation,
  theme,
  selectTheme,
}: {
  actions: CommandActions
  simulations?: ChannelSimulation[]
  index: number
  selectSimulation: (index: number) => void
  theme: Theme
  selectTheme: (theme: Theme) => void
}): JSX.Element {
  return (
    <div className="wb-toolbar" role="toolbar" aria-label="Workbench tools">
      <i className="wb-rebar" aria-hidden="true" />
      {toolbarGroups.map((group) => (
        <Fragment key={group[0]}>
          {group[0] !== "open" && <span className="wb-separator" />}
          {group.map((id) => {
            const { icon, label, shortcut, action } = workbenchCommand({
              id,
              actions,
            })
            return (
              <button
                key={id}
                title={shortcut ? `${label} (${shortcut})` : label}
                aria-label={label}
                disabled={!action}
                onClick={action}
              >
                {icon && <Icon name={icon} />}
              </button>
            )
          })}
        </Fragment>
      ))}
      <span className="wb-separator" />
      <label>
        Sim:{" "}
        <select
          aria-label="Active simulation"
          disabled={!simulations?.length}
          value={index}
          onChange={(event) => selectSimulation(Number(event.target.value))}
        >
          {!simulations?.length && <option value={0}>No simulation</option>}
          {simulations?.map((item, i) => (
            <option
              key={item.simulation_pcb_transient_channel_simulation_id}
              value={i}
            >
              {item.name ?? item.simulation_pcb_transient_channel_simulation_id}
            </option>
          ))}
        </select>
      </label>
      <label className="wb-theme-switch">
        Theme:{" "}
        <select
          aria-label="Theme"
          value={theme}
          onChange={(event) => {
            const value = themeIds.find((id) => id === event.target.value)
            if (value) selectTheme(value)
          }}
        >
          {themeIds.map((id) => (
            <option key={id} value={id}>
              {themes[id]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

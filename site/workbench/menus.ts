import { type CameraView, cameraViews } from "../channel-inspector/board-3d"
import type { ChannelSimulation } from "../channel-inspector/input"
import type { BoardView } from "./board-viewer"
import type { Command, Menu, Theme } from "./chrome"
import { themeIds, themes } from "./chrome"
import type { IconName } from "./icons"
import {
  type Arrange,
  type Frame,
  type WindowId,
  windowTitles,
} from "./windows"

const commandInfo = {
  open: ["Open Circuit JSON…", "Ctrl+O", "open"],
  sample: ["Open Sample", "Ctrl+Shift+O", "sample"],
  save: ["Save Design As…", "Ctrl+S", "save"],
  csv: ["Waveforms as CSV…", "Ctrl+E", "scope"],
  png: ["Active Window as PNG…", "Ctrl+Shift+P", "save"],
  close: ["Close Board", "Ctrl+W", null],
  undo: ["Undo Design Edit", "Ctrl+Z", null],
  redo: ["Redo Design Edit", "Ctrl+Y", null],
  victim: ["Make Selected Net Victim", "V", null],
  aggressor: ["Make Selected Net Aggressor", "A", null],
  exclude: ["Exclude Selected Net", "Delete", null],
  clear: ["Clear Selection", "Escape", null],
  board: ["Board Viewer", null, "board"],
  board3d: ["3D Board View", "1", null],
  board2d: ["2D Top View", "2", null],
  fit: ["Fit Board", "Home", null],
  hideFar: ["Hide Far Copper", "H", null],
  transparent: ["Transparent Substrate", "T", null],
  stackup: ["Stackup Editor", "Ctrl+K", "stackup"],
  assign: ["Assign Models…", "Ctrl+M", "models"],
  ibis: ["Visual IBIS Editor", "Ctrl+I", "ibisCurve"],
  stimulus: ["Stimulus / Aggressors…", "Ctrl+T", "stimulus"],
  run: ["Run", "F5", "run"],
  stop: ["Stop Simulation", "Shift+F5", "stop"],
  scope: ["Oscilloscope", "F6", "scope"],
  eye: ["Eye Diagram", "F7", null],
  compare: ["Compare Previous Run", null, null],
  log: ["Simulation Log", "Ctrl+Alt+L", "log"],
  solver: ["Check Local Solver Status", null, null],
  deck: ["View Compiled SPICE Deck…", null, null],
  reset: ["Reset Design to Loaded File", null, null],
  radius: ["Copper Scope Radius…", null, null],
  shortcuts: ["Keyboard Shortcuts…", "F1", null],
  guide: ["SI Workflow Quick Guide…", null, null],
  about: ["About SI Workbench", null, null],
} as const satisfies Record<
  string,
  readonly [string, string | null, IconName | null]
>
export type CommandId = keyof typeof commandInfo
export type CommandActions = Partial<Record<CommandId, () => void>> & {
  openRecent?: (name: string) => void
}
export const toolbarGroups = [
  ["open", "sample", "save"],
  ["board", "stackup", "assign", "ibis", "stimulus"],
  ["run", "stop", "scope", "log"],
] as const satisfies readonly (readonly CommandId[])[]

/** Read one command's label, accelerator, icon, and availability. */
export function workbenchCommand({
  id,
  actions,
}: {
  id: CommandId
  actions: CommandActions
}): Command & { icon?: IconName } {
  const [label, shortcut, icon] = commandInfo[id]
  return {
    label,
    shortcut: shortcut ?? undefined,
    action: actions[id],
    icon: icon ?? undefined,
  }
}

interface MenuOptions {
  boardView: BoardView
  selectCamera?: (camera: CameraView) => void
  simulations?: ChannelSimulation[]
  simulationIndex: number
  selectSimulation: (index: number) => void
  clearRecent: () => void
  activeFrame?: Frame
  resetLayout: () => void
  arrangeIcons: () => void
  actions: CommandActions
  recent: string[]
  theme: Theme
  selectTheme: (theme: Theme) => void
  showTree: boolean
  toggleTree: () => void
  showProperties: boolean
  toggleProperties: () => void
  frames: Frame[]
  showWindow: (id: WindowId) => void
  arrange: (mode: Arrange) => void
  comparing?: boolean
}

/** Bind the current command actions to their menu information. */
function bindCommands(actions: CommandActions): (id: CommandId) => Command {
  return (id) => workbenchCommand({ id, actions })
}

/** Flatten leaf shortcuts for the keyboard reference dialog. */
export function menuShortcuts(menus: Menu[]): Command[] {
  return menus.flatMap(({ items }) => commandShortcuts(items))
}

/** Read the visible accelerator labels even if a command is currently disabled. */
function commandShortcuts(commands: Command[]): Command[] {
  return commands.flatMap((command) => {
    if (command.items) return commandShortcuts(command.items)
    return command.shortcut ? [command] : []
  })
}

/** Collect all desktop commands in the menu bar and keyboard dispatch. */
export function workbenchMenus(options: MenuOptions): Menu[] {
  const {
    actions,
    recent,
    theme,
    selectTheme,
    showTree,
    toggleTree,
    showProperties,
    toggleProperties,
    frames,
    showWindow,
    arrange,
  } = options
  const item = bindCommands(actions)
  const { openRecent } = actions
  return [
    {
      label: "File",
      items: [
        item("open"),
        item("sample"),
        {
          label: "Open Recent",
          items: recent.length
            ? [
                ...recent.map((name) => ({
                  label: name,
                  action: openRecent && (() => openRecent(name)),
                })),
                { label: "Recent operations", separator: true },
                { label: "Clear Recent", action: options.clearRecent },
              ]
            : [{ label: "(No recent files)" }],
        },
        { label: "File operations", separator: true },
        item("save"),
        { label: "Export", items: [item("csv"), item("png")] },
        { label: "Board lifecycle", separator: true },
        item("close"),
      ],
    },
    {
      label: "Edit",
      items: [
        item("undo"),
        item("redo"),
        { label: "Net roles", separator: true },
        item("victim"),
        item("aggressor"),
        item("exclude"),
        item("clear"),
      ],
    },
    {
      label: "View",
      items: [
        {
          ...item("board3d"),
          checked: options.boardView.mode === "3D",
          radio: true,
        },
        {
          ...item("board2d"),
          checked: options.boardView.mode === "2D",
          radio: true,
        },
        { label: "Board camera", separator: true },
        {
          label: "Camera",
          items: [
            ...cameraViews.map((camera, index) => ({
              label: camera === "Iso" ? "Isometric" : camera,
              shortcut: `Ctrl+${index + 1}`,
              action:
                options.selectCamera && (() => options.selectCamera?.(camera)),
              checked:
                options.boardView.mode === "3D" &&
                options.boardView.camera === camera,
              radio: true,
            })),
            { label: "Camera operations", separator: true },
            item("fit"),
          ],
        },
        { ...item("hideFar"), checked: options.boardView.hideFar },
        { ...item("transparent"), checked: options.boardView.transparent },
        { label: "Docking", separator: true },
        {
          label: "Project Explorer",
          shortcut: "Ctrl+Alt+P",
          checked: showTree,
          action: toggleTree,
        },
        {
          label: "Properties Inspector",
          shortcut: "Ctrl+Alt+R",
          checked: showProperties,
          action: toggleProperties,
        },
        item("log"),
        { label: "Appearance", separator: true },
        {
          label: "Theme",
          items: themeIds.map((id) => ({
            label: themes[id],
            checked: theme === id,
            action: () => selectTheme(id),
          })),
        },
      ],
    },
    {
      label: "Setup",
      items: [
        item("stackup"),
        item("stimulus"),
        item("radius"),
        { label: "Simulation selection", separator: true },
        {
          label: "Active Simulation",
          items: options.simulations?.map((simulation, index) => ({
            label:
              simulation.name ??
              simulation.simulation_pcb_transient_channel_simulation_id,
            checked: index === options.simulationIndex,
            radio: true,
            action: () => options.selectSimulation(index),
          })) ?? [{ label: "(No simulations)" }],
        },
      ],
    },
    {
      label: "Models",
      items: [
        item("assign"),
        item("ibis"),
        { label: "External", separator: true },
        { label: "Load External IBIS…", title: "Coming later" },
      ],
    },
    {
      label: "Simulate",
      mnemonic: 1,
      items: [
        item("run"),
        item("stop"),
        { label: "Results", separator: true },
        item("scope"),
        item("eye"),
        { ...item("compare"), checked: options.comparing },
        item("solver"),
      ],
    },
    {
      label: "Tools",
      items: [
        {
          ...item("stackup"),
          label: "Impedance / Delay Calculator",
          shortcut: undefined,
        },
        item("deck"),
        item("reset"),
      ],
    },
    {
      label: "Window",
      items: [
        ...(
          [
            "Cascade",
            "Tile Horizontally",
            "Tile Vertically",
            "Maximize",
          ] as const
        ).map((mode) => ({
          label: mode,
          shortcut: mode === "Cascade" ? "Shift+F4" : undefined,
          action: () => arrange(mode),
        })),
        { label: "Arrange Icons", action: options.arrangeIcons },
        { label: "Workspace", separator: true },
        { label: "Reset Workspace Layout", action: options.resetLayout },
        { label: "Child windows", separator: true },
        ...frames.map(({ id }, index) => ({
          label: `${index + 1} ${windowTitles[id]}`,
          checked: options.activeFrame?.id === id,
          radio: true,
          action: () => showWindow(id),
        })),
      ],
    },
    {
      label: "Help",
      items: [
        item("shortcuts"),
        item("guide"),
        { label: "Product", separator: true },
        item("about"),
      ],
    },
  ]
}

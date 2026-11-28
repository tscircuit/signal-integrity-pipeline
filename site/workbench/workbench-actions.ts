import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react"
import type { CircuitJson } from "../../src/board"
import {
  type ChannelSimulation,
  DdrBoardUnavailable,
  type InspectorInput,
  type InspectorSample,
  loadInput,
  sampleNames,
} from "../channel-inspector/input"
import type { BoardSelection } from "./board-selection"
import type { BoardView } from "./board-viewer"
import type { DesignHistory } from "./design-history"
import { exportDesign, exportWaveforms, exportWindow } from "./exports"
import type { SimulationRun } from "./local-run"
import type { CommandActions } from "./menus"
import { editNetRole, type NetRole } from "./model/net-roles"
import type { ScopeTab } from "./oscilloscope"
import type { ProjectNode } from "./project"
import type { SimulationState } from "./simulation-state"
import { loadRecent, saveRecent } from "./storage"
import type { Frame, Windows } from "./windows"
import type { ActiveDialog } from "./workbench-dialogs"

/** The open board session and its file and edit commands. */
interface BoardSession {
  busy: boolean
  status: string
  recent: string[]
  setRecent: Dispatch<SetStateAction<string[]>>
  load: (source: File | InspectorSample) => Promise<void>
  closeBoard: () => void
  changeRole: (role: NetRole) => void
  apply: (circuit: CircuitJson) => void
}

/** Manage local loading and immutable edits for the active board. */
export function useBoardSession({
  design,
  runner,
  selection,
  simulation,
  windows,
  initialSample,
  setError,
  setDialog,
  onOpen,
}: {
  design: DesignHistory
  runner: SimulationState
  selection: BoardSelection
  simulation?: ChannelSimulation
  windows: Windows
  initialSample?: InspectorSample
  setError: (message?: string) => void
  setDialog: (dialog?: ActiveDialog) => void
  onOpen: (input?: InspectorInput) => void
}): BoardSession {
  const [recent, setRecent] = useState(loadRecent)
  const [status, setStatus] = useState("Ready")
  const [busy, setBusy] = useState(false)
  const loading = useRef<AbortController>(undefined)
  const session: BoardSession = {
    recent,
    setRecent,
    status,
    busy,
    load: async (source) => {
      if (loading.current || runner.solver === "running") return
      const controller = new AbortController()
      const { signal } = controller
      loading.current = controller
      setBusy(true)
      setError(undefined)
      setDialog(undefined)
      setStatus("Reading Circuit JSON…")
      try {
        const next = await loadInput({ source, signal, onStatus: setStatus })
        if (signal.aborted) return
        selection.reset()
        runner.reset()
        windows.reset()
        windows.show("board")
        design.open(next)
        setRecent((previous) =>
          saveRecent({ name: next.name, recent: previous }),
        )
        onOpen(next)
        setStatus("Ready")
      } catch (cause) {
        if (signal.aborted) return
        if (cause instanceof DdrBoardUnavailable)
          setDialog({ kind: "ddr-unavailable", message: cause.message })
        else setError((cause as Error).message)
        setStatus("Open failed")
      } finally {
        if (loading.current === controller) {
          loading.current = undefined
          setBusy(false)
        }
      }
    },
    closeBoard: () => {
      design.open()
      selection.reset()
      runner.reset()
      windows.reset()
      windows.show("start")
      onOpen()
      setError(undefined)
      setStatus("Ready")
    },
    apply: (circuit) => {
      design.edit(circuit)
      setError(undefined)
    },
    changeRole: (role) => {
      const { input } = design
      const trace = selection.selected?.record
      if (
        !input ||
        !simulation ||
        trace?.type !== "pcb_trace" ||
        selection.selected?.category === "rail"
      )
        return
      try {
        design.edit(
          editNetRole({ circuit: input.circuit, simulation, trace, role }),
        )
        setError(undefined)
      } catch (cause) {
        setError((cause as Error).message)
      }
    },
  }
  useEffect(() => {
    if (initialSample) void session.load(initialSample)
    return () => {
      loading.current?.abort()
      loading.current = undefined
    }
  }, [initialSample])
  return session
}

/** Bind menu and toolbar commands to the active session. */
export function workbenchActions({
  session,
  design,
  runner,
  windows,
  simulation,
  boardView,
  activeFrame,
  chosenNode,
  lastRun,
  activeRun,
  canCompare,
  canEditRole,
  openFile,
  setError,
  setDialog,
  setScopeTab,
  toggleCompare,
  clear,
  onCapture,
}: {
  session: BoardSession
  design: DesignHistory
  runner: SimulationState
  windows: Windows
  simulation?: ChannelSimulation
  boardView: BoardView
  activeFrame?: Frame
  chosenNode?: ProjectNode
  lastRun?: SimulationRun
  activeRun?: SimulationRun
  canCompare: boolean
  canEditRole: boolean
  openFile: () => void
  setError: (message?: string) => void
  setDialog: (dialog?: ActiveDialog) => void
  setScopeTab: (tab: ScopeTab) => void
  toggleCompare: () => void
  clear: () => void
  onCapture: () => void
}): CommandActions {
  const { input } = design
  const available = !session.busy && runner.solver !== "running"
  return {
    open: available ? openFile : undefined,
    sample: available ? () => void session.load("default") : undefined,
    openRecent: available
      ? (name) => {
          if (name === sampleNames.default) return void session.load("default")
          if (name === sampleNames.ddr) return void session.load("ddr")
          openFile()
        }
      : undefined,
    save: input && (() => exportDesign(input)),
    csv: activeRun && (() => exportWaveforms(activeRun)),
    png:
      activeFrame &&
      (() =>
        void exportWindow(activeFrame.id).catch((cause: Error) =>
          setError(cause.message),
        )),
    close:
      input && available
        ? () => {
            if (design.dirty) setDialog({ kind: "discard" })
            else session.closeBoard()
          }
        : undefined,
    undo:
      design.undo &&
      (() => {
        design.undo?.()
        setError(undefined)
      }),
    redo:
      design.redo &&
      (() => {
        design.redo?.()
        setError(undefined)
      }),
    reset:
      design.reset &&
      (() => {
        design.reset?.()
        setError(undefined)
      }),
    board: input && (() => windows.show("board")),
    board3d:
      input &&
      (() => {
        boardView.setMode("3D")
        windows.show("board")
      }),
    board2d:
      input &&
      (() => {
        boardView.setMode("2D")
        windows.show("board")
      }),
    fit:
      input &&
      (() => {
        boardView.fit()
        windows.show("board")
      }),
    hideFar:
      input &&
      (() => {
        boardView.setHideFar(!boardView.hideFar)
        windows.show("board")
      }),
    transparent:
      input &&
      (() => {
        boardView.setTransparent(!boardView.transparent)
        windows.show("board")
      }),
    stackup: input && (() => windows.show("stackup")),
    run:
      input && simulation && available
        ? () => {
            windows.show("log")
            void runner.start({ input, simulation, onCapture })
          }
        : undefined,
    stop: runner.stop,
    scope: () => {
      setScopeTab("Waveforms")
      windows.show("scope")
    },
    eye: () => {
      setScopeTab("Eye Diagram")
      windows.show("scope")
    },
    compare: canCompare
      ? () => {
          toggleCompare()
          windows.show("scope")
        }
      : undefined,
    log: () => windows.show("log"),
    solver: () => {
      windows.show("log")
      void runner.check(true)
    },
    deck: lastRun && (() => setDialog({ kind: "deck" })),
    stimulus: simulation && (() => setDialog({ kind: "stimulus" })),
    radius: simulation && (() => setDialog({ kind: "radius" })),
    assign:
      input &&
      (() =>
        setDialog({
          kind: "assign",
          port: chosenNode?.port,
          modelId: chosenNode?.modelId,
        })),
    ibis: input && (() => windows.show("ibis")),
    victim: canEditRole ? () => session.changeRole("selected") : undefined,
    aggressor: canEditRole ? () => session.changeRole("near") : undefined,
    exclude: canEditRole ? () => session.changeRole("excluded") : undefined,
    clear,
    shortcuts: () => setDialog({ kind: "shortcuts" }),
    guide: () => setDialog({ kind: "guide" }),
    about: () => setDialog({ kind: "about" }),
  }
}

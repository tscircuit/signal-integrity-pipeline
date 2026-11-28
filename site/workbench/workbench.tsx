import {
  type JSX,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { InspectorSample } from "../channel-inspector/input"
import type { IbisFocus } from "./assign-models"
import { useBoardSelection } from "./board-selection"
import { BoardViewer, useBoardView } from "./board-viewer"
import { MenuBar } from "./chrome"
import { CopperMenu, useCopperContextDismiss } from "./copper-menu"
import { useDesignHistory } from "./design-history"
import { DesktopStatus, DesktopTitle } from "./desktop-frame"
import { Dock, Properties } from "./docks"
import { exportWindow } from "./exports"
import { IbisViewer } from "./ibis-viewer"
import { CaptionIcon } from "./icons"
import { workbenchMenus } from "./menus"
import { netRoles } from "./model/net-roles"
import { stimulusRadius } from "./model/stimulus"
import { Oscilloscope, type ScopeTab } from "./oscilloscope"
import { findProjectNode, type ProjectNode, ProjectTree } from "./project"
import { projectNodes } from "./project-nodes"
import { captureNodes, diagnosticNode } from "./run-project"
import { SimulationLog } from "./simulation-log"
import { useSimulation } from "./simulation-state"
import { StackupEditor } from "./stackup-editor"
import { StartPage } from "./start-page"
import { clearRecent, loadTheme, setTheme } from "./storage"
import { Toolbar } from "./toolbar"
import { ChildWindow, MinimizedWindows, useWindows } from "./windows"
import { useBoardSession, workbenchActions } from "./workbench-actions"
import { type ActiveDialog, WorkbenchDialogs } from "./workbench-dialogs"
import "./workbench.css"

/** Desktop entry point for offline Circuit JSON inspection and simulation. */
export function Workbench({
  initialSample,
}: {
  initialSample?: InspectorSample
}): JSX.Element {
  const [theme, selectTheme] = useState(loadTheme)
  const design = useDesignHistory()
  const runner = useSimulation()
  const [selectedRun, setSelectedRun] = useState<number>()
  const [scopeTab, setScopeTab] = useState<ScopeTab>("Waveforms")
  const [compare, setCompare] = useState(false)
  const [dialog, setDialog] = useState<ActiveDialog>()
  const { input } = design
  const [simulationIndex, setSimulationIndex] = useState(0)
  const [treeId, setTreeId] = useState<string>()
  const [showTree, setShowTree] = useState(true)
  const [showProperties, setShowProperties] = useState(true)
  const simulation = input?.simulations[simulationIndex]
  const [ibisFocus, setIbisFocus] = useState<IbisFocus>()
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const windows = useWindows()
  const boardView = useBoardView()
  const [layoutKey, setLayoutKey] = useState(0)
  useLayoutEffect(() => setTheme(theme), [theme])
  const selection = useBoardSelection({
    input,
    simulation,
    onPick: useCallback(() => setTreeId(undefined), []),
  })
  const activeZ = Math.max(
    0,
    ...windows.frames.filter((frame) => !frame.minimized).map(({ z }) => z),
  )
  const root = useMemo(
    () =>
      input &&
      projectNodes({
        input,
        active: simulation,
        features: selection.features,
        results: captureNodes(runner.runs),
      }),
    [input, simulation, selection.features, runner.runs],
  )
  const chosenNode = findProjectNode({
    root,
    id: treeId,
    copper: treeId ? undefined : selection.selected?.id,
  })
  const boardFocus = selection.selected ?? selection.hovered
  useCopperContextDismiss(selection)
  const session = useBoardSession({
    design,
    runner,
    selection,
    simulation,
    windows,
    initialSample,
    setError,
    setDialog,
    onOpen: (next) => {
      setSelectedRun(undefined)
      setCompare(false)
      setSimulationIndex(0)
      setTreeId(next ? "board" : undefined)
      setIbisFocus(undefined)
      setDialog(undefined)
    },
  })
  const { status, recent, load, closeBoard, changeRole, apply } = session
  const pickNode = useCallback(
    (node: ProjectNode) => {
      if (node.simulation !== undefined && node.simulation !== simulationIndex)
        setSimulationIndex(node.simulation)
      setTreeId(node.id)
      selection.select(node.copper?.id)
    },
    [simulationIndex, selection.select],
  )
  const openNode = useCallback(
    (node: ProjectNode) => {
      if (node.window === "scope") {
        setSelectedRun(node.run)
        setScopeTab("Waveforms")
        windows.show("scope")
        return
      }
      if (node.window) windows.show(node.window)
      else if (node.modelId)
        setDialog({ kind: "assign", port: node.port, modelId: node.modelId })
    },
    [windows],
  )
  const selectSimulation = useCallback(
    (index: number) => {
      selection.select(undefined)
      setTreeId(undefined)
      setSimulationIndex(index)
    },
    [selection.select],
  )
  const lastRun = runner.runs.at(-1)
  const activeRun = runner.runs.find(({ id }) => id === selectedRun) ?? lastRun
  const canCompare =
    activeRun !== undefined &&
    runner.runs.some(
      (item) =>
        item.id < activeRun.id && item.simulationId === activeRun.simulationId,
    )
  const activeFrame = windows.frames.find(
    ({ z, minimized }) => z === activeZ && !minimized,
  )
  const canEditRole =
    selection.selected?.record.type === "pcb_trace" &&
    selection.selected.category !== "rail"
  const actions = workbenchActions({
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
    openFile: () => fileInput.current?.click(),
    setError,
    setDialog,
    setScopeTab,
    toggleCompare: () => setCompare((value) => !value),
    clear: () => {
      selection.select(undefined)
      setTreeId(undefined)
    },
    onCapture: () => {
      setSelectedRun(undefined)
      setScopeTab("Waveforms")
      windows.show("scope")
      setError(undefined)
    },
  })
  const hoverNode =
    selection.hovered && findProjectNode({ root, copper: selection.hovered.id })
  const selectedNode =
    selection.selected &&
    findProjectNode({ root, copper: selection.selected.id })
  const knownRole =
    selection.selected &&
    (netRoles(simulation)[selection.selected.id] ??
      (selection.selected.category === "selected" ||
      selection.selected.category === "near"
        ? selection.selected.category
        : undefined))
  const ibisNode = chosenNode?.modelId
    ? chosenNode
    : findProjectNode({ root, id: chosenNode?.port })
  const menus = workbenchMenus({
    actions,
    boardView,
    selectCamera:
      input &&
      ((camera) => {
        boardView.chooseCamera(camera)
        windows.show("board")
      }),
    simulations: input?.simulations,
    simulationIndex,
    selectSimulation,
    activeFrame,
    resetLayout: () => {
      setLayoutKey((key) => key + 1)
      setShowTree(true)
      setShowProperties(true)
      windows.resetLayout()
    },
    arrangeIcons: windows.arrangeIcons,
    clearRecent: () => {
      clearRecent()
      session.setRecent([])
    },
    comparing: compare && canCompare,
    recent,
    theme,
    selectTheme,
    showTree,
    toggleTree: () => setShowTree(!showTree),
    showProperties,
    toggleProperties: () => setShowProperties(!showProperties),
    frames: windows.frames,
    showWindow: windows.show,
    arrange: windows.arrange,
  })
  return (
    <main
      className="wb-desktop"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const file = event.dataTransfer.files[0]
        if (file) void load(file)
      }}
    >
      <DesktopTitle
        board={input?.name}
        simulation={simulation?.name}
        dirty={design.dirty}
        close={actions.close}
        toggleDocks={() => {
          const next = !showTree && !showProperties
          setShowTree(next)
          setShowProperties(next)
        }}
        toggleFullscreen={() => {
          const pending = document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen()
          void pending.catch((cause: Error) => setError(cause.message))
        }}
      />
      <MenuBar menus={menus} />
      <Toolbar
        actions={actions}
        simulations={input?.simulations}
        index={simulationIndex}
        selectSimulation={selectSimulation}
        theme={theme}
        selectTheme={selectTheme}
      />
      <input
        type="file"
        ref={fileInput}
        hidden
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void load(file)
          event.currentTarget.value = ""
        }}
      />
      <div className="wb-docks">
        <Dock
          layoutKey={layoutKey}
          side="left"
          title="Project Explorer"
          shown={showTree}
          close={() => setShowTree(false)}
        >
          <ProjectTree
            root={root}
            selected={chosenNode?.id}
            pick={pickNode}
            open={openNode}
            context={({ node, event }) => {
              if (!node.copper) return
              event.preventDefault()
              selection.interaction.onContext?.({
                feature: node.copper,
                x: event.clientX,
                y: event.clientY,
              })
            }}
          />
        </Dock>
        <div className="wb-workspace" aria-label="Window workspace">
          {windows.frames.map((frame) => (
            <ChildWindow
              key={frame.id}
              frame={frame}
              active={frame.z === activeZ}
              activate={() => windows.show(frame.id)}
              close={() => windows.close(frame.id)}
              change={windows.change}
            >
              {frame.id === "start" && (
                <StartPage
                  recent={recent}
                  openFile={actions.open}
                  openRecent={actions.openRecent}
                  openSample={actions.open && ((sample) => void load(sample))}
                  runner={runner}
                />
              )}
              {input && frame.id === "board" && (
                <BoardViewer
                  board={input.board}
                  circuit={input.circuit}
                  features={selection.features}
                  theme={theme}
                  interaction={selection.interaction}
                  view={boardView}
                  radiusMm={stimulusRadius({
                    simulation,
                    defaultMm: input.distanceMm,
                  })}
                  hoverLabel={hoverNode?.label ?? selection.hovered?.id}
                  error={selection.error}
                />
              )}
              {input && frame.id === "stackup" && (
                <StackupEditor
                  circuit={input.circuit}
                  feature={selection.selected}
                  apply={apply}
                  close={() => windows.close("stackup")}
                />
              )}
              {input && frame.id === "ibis" && (
                <IbisViewer
                  key={`${ibisFocus?.modelId ?? ""}:${ibisFocus?.buffer ?? ""}`}
                  circuit={input.circuit}
                  original={design.original!.circuit}
                  initial={ibisFocus}
                  apply={apply}
                />
              )}
              {frame.id === "log" && (
                <SimulationLog
                  entries={runner.entries}
                  clear={runner.clearLog}
                  targets={(entry) => diagnosticNode({ root, entry })}
                  showDeck={actions.deck}
                  showOnBoard={(id) => {
                    const node = findProjectNode({ root, id })
                    if (node) pickNode(node)
                    windows.show("board")
                  }}
                />
              )}
              {frame.id === "scope" && (
                <Oscilloscope
                  runs={runner.runs}
                  run={activeRun}
                  selectRun={setSelectedRun}
                  tab={scopeTab}
                  selectTab={setScopeTab}
                  compare={compare}
                  toggleCompare={() => setCompare(!compare)}
                  exportCsv={actions.csv}
                  exportPng={() =>
                    void exportWindow("scope").catch((cause: Error) =>
                      setError(cause.message),
                    )
                  }
                />
              )}
            </ChildWindow>
          ))}
          <MinimizedWindows
            frames={windows.frames}
            restore={windows.show}
            close={windows.close}
          />
        </div>
        <Dock
          layoutKey={layoutKey}
          side="right"
          title="Properties Inspector"
          shown={showProperties}
          close={() => setShowProperties(false)}
        >
          <Properties
            key={chosenNode?.id ?? boardFocus?.id}
            node={chosenNode ?? (boardFocus ? undefined : root)}
            feature={boardFocus}
            editRole={canEditRole ? changeRole : undefined}
            role={knownRole}
            editModel={
              chosenNode?.modelId ? () => openNode(chosenNode) : undefined
            }
          />
        </Dock>
      </div>
      {error && (
        <div className="wb-error" role="alert">
          <span>{error}</span>
          <button
            aria-label="Dismiss error"
            onClick={() => setError(undefined)}
          >
            <CaptionIcon name="close" />
          </button>
        </div>
      )}
      <DesktopStatus
        runner={runner}
        status={status}
        cursor={selection.cursor}
        picked={selection.selected}
        pickedLabel={selectedNode?.label ?? selection.selected?.id}
        hovered={selection.hovered}
      />
      {selection.context && (
        <CopperMenu
          context={selection.context}
          editable={canEditRole}
          current={knownRole}
          extra={[
            {
              label: "Assign IBIS Model…",
              action: ibisNode?.modelId ? () => openNode(ibisNode) : undefined,
            },
            {
              label: "View IBIS Curves",
              action:
                ibisNode?.modelId && ibisNode.buffer
                  ? () => {
                      setIbisFocus({
                        modelId: ibisNode.modelId!,
                        buffer: ibisNode.buffer,
                      })
                      windows.show("ibis")
                    }
                  : undefined,
            },
            { label: "Fit Board", action: actions.fit },
            {
              label: "Toggle 2D/3D",
              action:
                boardView.mode === "3D" ? actions.board2d : actions.board3d,
            },
          ]}
          edit={changeRole}
          close={selection.closeContext}
        />
      )}
      <WorkbenchDialogs
        dialog={dialog}
        input={input}
        simulation={simulation}
        retained={selection.retained}
        apply={apply}
        close={() => setDialog(undefined)}
        closeBoard={closeBoard}
        lastRun={lastRun}
        version={runner.version}
        menus={menus}
        showCurves={(focus) => {
          setIbisFocus(focus)
          setDialog(undefined)
          windows.show("ibis")
        }}
      />
    </main>
  )
}

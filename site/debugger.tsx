/* eslint-disable local/max-file-lines -- Keep the debugger controls and their atlas rendering together. */
import { cju } from "@tscircuit/circuit-json-util"
import { Circuit } from "@tscircuit/core"
import {
  GenericSolverDebugger,
  type GenericSolverDebuggerProps,
} from "@tscircuit/solver-utils/react"
import type { GraphicsObject, Viewbox } from "graphics-debug"
import type React from "react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createHttpSolver } from "../src/adapters/browser"
import type { CircuitJson } from "../src/board"
// Imported directly: circuit-to-svg is a development dependency and never enters the library bundle.
import { boardPicture, boardPictureView } from "../src/board/board-picture"
import type { IbisSources } from "../src/buffers"
import { RoutedPipelineSolver } from "../src/pipeline"

/** Pixel translation and scale applied to the rendered atlas. */
type AtlasMove = {
  x: number
  y: number
  zoom: number
}

/** The atlas's pixel height stays within these bounds as the container resizes. */
const MIN_ATLAS_HEIGHT_PX = 360
const MAX_ATLAS_HEIGHT_PX = 720
/** Keep the aspect ratio finite for a camera whose horizontal span is zero. */
const MIN_CAMERA_WIDTH = 1e-9
/** Wheel sensitivity and the zoom limit relative to the full board. */
const WHEEL_ZOOM_SENSITIVITY = 0.002
const MAX_ATLAS_ZOOM = 20
/** Near-full-width views can reuse the default camera. */
const FULL_CAMERA_WIDTH_FRACTION = 0.999
/** Wait for panning and zooming to settle before regenerating the visible drawing. */
const REDRAW_DELAY_MS = 250
/** Offset the hover label so the pointer does not cover it. */
const HOVER_OFFSET_PX = 12

/** A native wheel listener for zooming the routed atlas. */
type AtlasWheelListener = (event: WheelEvent) => void

/** Zoom about the cursor only with ctrl/⌘, so the page still scrolls normally. */
function createAtlasWheelListener({
  element,
  base,
  setMove,
}: {
  element: HTMLDivElement
  base: React.RefObject<number>
  setMove: React.Dispatch<React.SetStateAction<AtlasMove>>
}): AtlasWheelListener {
  return (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const box = element.getBoundingClientRect()
    setMove(({ x, y, zoom }) => {
      const requestedZoom =
        zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY)
      const minZoom = 1 / base.current
      const maxZoom = MAX_ATLAS_ZOOM / base.current
      const next = Math.min(maxZoom, Math.max(minZoom, requestedZoom))
      const factor = next / zoom
      const pointerX = event.clientX - box.left
      const pointerY = event.clientY - box.top
      return {
        zoom: next,
        x: pointerX - (pointerX - x) * factor,
        y: pointerY - (pointerY - y) * factor,
      }
    })
  }
}

/** Convert the visible container corners to board coordinates after panning or zooming. */
function zoomedRegion({
  width,
  height,
  view,
  camera,
  move,
}: {
  width: number
  height: number
  view: Viewbox
  camera: Viewbox
  move: AtlasMove
}): Viewbox | undefined {
  const scale = Math.min(
    width / (view.maxX - view.minX),
    height / (view.maxY - view.minY),
  )
  const left = (width - (view.maxX - view.minX) * scale) / 2
  const top = (height - (view.maxY - view.minY) * scale) / 2
  const minX = view.minX + ((0 - move.x) / move.zoom - left) / scale
  const maxX = view.minX + ((width - move.x) / move.zoom - left) / scale
  if (maxX - minX >= (camera.maxX - camera.minX) * FULL_CAMERA_WIDTH_FRACTION)
    return
  return {
    minX,
    maxX,
    minY: view.maxY - ((height - move.y) / move.zoom - top) / scale,
    maxY: view.maxY - ((0 - move.y) / move.zoom - top) / scale,
  }
}

/** Dim other labels while retaining enough contrast to see the routed context. */
const UNFOCUSED_LABEL_OPACITY = 0.2

/** Dim labels other than the one under the cursor while keeping the camera visible. */
function atlasHoverStyle(label: string): string {
  const labelledLayer =
    '.routed-atlas-layers [data-label]:not([data-label=""]):not([data-label="camera"])'
  return `${labelledLayer}:not([data-label=${JSON.stringify(label)}]) { opacity: ${UNFOCUSED_LABEL_OPACITY} }`
}

/** Mount the generated SVG as inline DOM so its labels participate in pointer events. */
function AtlasLayer({ svg }: { svg: string }): React.JSX.Element {
  const layer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const picture = new DOMParser().parseFromString(svg, "text/html")
    const root = picture.body.firstElementChild
    if (root instanceof SVGSVGElement) layer.current?.replaceChildren(root)
  }, [svg])
  return <div ref={layer} />
}

/**
 * The real board under the stage drawing at the container's width.
 * Ctrl/⌘ + wheel zooms (1–20×) and dragging pans; after a pause the zoomed region is re-rendered crisply.
 * Hovering a net, curve or mark dims everything else that is labelled and names it.
 */
function RoutedAtlas({
  circuit,
  graphics,
}: {
  circuit: CircuitJson
  graphics: GraphicsObject
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [region, setRegion] = useState<Viewbox>()
  const [move, setMove] = useState<AtlasMove>({ x: 0, y: 0, zoom: 1 })
  const [hover, setHover] = useState<{
    label: string
    x: number
    y: number
  }>()
  const camera = boardPictureView({ circuit, drawing: graphics })
  const view = region ?? camera
  const cameraWidth = camera.maxX - camera.minX
  const cameraHeight = camera.maxY - camera.minY
  const scaledHeight =
    (width * cameraHeight) / Math.max(cameraWidth, MIN_CAMERA_WIDTH)
  const height = Math.round(
    Math.min(MAX_ATLAS_HEIGHT_PX, Math.max(MIN_ATLAS_HEIGHT_PX, scaledHeight)),
  )
  // Zoom of the rendered region relative to the full camera; CSS zoom on top of it stays within 1–20× overall.
  const base = useRef(1)
  base.current = cameraWidth / (view.maxX - view.minX)
  useEffect(() => {
    const element = container.current!
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    )
    observer.observe(element)
    const zoom = createAtlasWheelListener({ element, base, setMove })
    element.addEventListener("wheel", zoom, { passive: false })
    return (): void => {
      observer.disconnect()
      element.removeEventListener("wheel", zoom)
    }
  }, [])
  useEffect(() => {
    if (move.zoom === 1 && move.x === 0 && move.y === 0) return
    // Once interaction pauses, the visible part becomes the rendered region: sharp copper, same-size labels.
    const timer = setTimeout(() => {
      setRegion(
        zoomedRegion({
          width,
          height,
          view,
          camera,
          move,
        }),
      )
      setMove({ x: 0, y: 0, zoom: 1 })
    }, REDRAW_DELAY_MS)
    return (): void => clearTimeout(timer)
  }, [move])
  const picture = useMemo(() => {
    if (!(width > 0)) return
    return boardPicture({
      circuit,
      drawing: graphics,
      width,
      height,
      region,
    })
  }, [circuit, graphics, width, height, region])
  const { x, y, zoom } = move
  const transform = `translate(${x}px, ${y}px) scale(${zoom})`
  return (
    <div
      ref={container}
      className="routed-atlas"
      aria-label="Routed pipeline atlas"
      style={{ height }}
      onDoubleClick={() => {
        setRegion(undefined)
        setMove({ x: 0, y: 0, zoom: 1 })
      }}
      onPointerMove={(event) => {
        const canPan = event.buttons === 1 && base.current * move.zoom > 1
        if (canPan) {
          setMove((move) => ({
            ...move,
            x: move.x + event.movementX,
            y: move.y + event.movementY,
          }))
        }
        const label = (event.target as Element)
          .closest?.("[data-label]")
          ?.getAttribute("data-label")
        const box = container.current!.getBoundingClientRect()
        if (!label || label === "camera") return setHover(undefined)
        setHover({
          label,
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        })
      }}
      onPointerLeave={() => setHover(undefined)}
    >
      {picture && (
        <div className="routed-atlas-layers" style={{ transform }}>
          <AtlasLayer svg={picture.board} />
          <AtlasLayer svg={picture.overlay} />
        </div>
      )}
      {hover && (
        <>
          <style>{atlasHoverStyle(hover.label)}</style>
          <span
            className="routed-atlas-label"
            style={{
              left: hover.x + HOVER_OFFSET_PX,
              top: hover.y + HOVER_OFFSET_PX,
            }}
          >
            {hover.label}
          </span>
        </>
      )}
    </div>
  )
}

/** Graphics cached against a stage and solver state. */
interface CachedStageDrawing {
  key: string
  graphics: GraphicsObject
}

const drawings = new WeakMap<RoutedPipelineSolver, CachedStageDrawing>()

/** Draw a stage once per solver state. */
function stageDrawing({
  root,
  number,
}: {
  root: RoutedPipelineSolver
  number: number
}): GraphicsObject {
  const solver = root.getSolver(root.pipelineDef[number - 1]?.solverName ?? "")
  const key = `${number}:${root.iterations}:${solver?.iterations}:${solver?.solved}:${solver?.failed}`
  const cached = drawings.get(root)
  if (cached?.key === key) return cached.graphics
  const graphics = root.visualizeStage(number)
  drawings.set(root, { key, graphics })
  return graphics
}

/** Render the stage with a fresh camera when the stage number changes. */
function renderStage({
  root,
  number,
}: {
  root: RoutedPipelineSolver
  number: number
}): React.JSX.Element {
  const graphics = stageDrawing({ root, number })
  return (
    <RoutedAtlas
      key={number}
      circuit={root.inputProblem.circuitJson}
      graphics={graphics}
    />
  )
}

/** TSX or Circuit JSON board input and the model assets required by the debugger. */
export interface BoardPageProps {
  "board-tree"?: React.ReactElement
  "load-board"?: () => Promise<CircuitJson>
  models: string[]
}

/** Read a fixed local asset via the dev backend; vendor bytes stay outside the repository. */
export async function localAsset(name: string): Promise<string> {
  const response = await fetch(`/api/local-assets/${encodeURIComponent(name)}`)
  const body = (await response.json()) as {
    text?: string
    error?: string
  }
  if (!response.ok || body.text === undefined)
    throw new Error(body.error ?? `missing local asset: ${name}`)
  return body.text
}

/** Render a TSX board's asset references and declarations. */
async function renderBoard(tree: React.ReactElement): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(tree)
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson()
  const errors = records.filter((record) => record.type.endsWith("_error"))
  if (errors.length) throw new Error(JSON.stringify(errors))
  return records
}

/** Load Circuit JSON through the fixture's selected input. */
function loadCircuitJson({
  loadBoard,
  boardTree,
}: {
  loadBoard?: BoardPageProps["load-board"]
  boardTree?: BoardPageProps["board-tree"]
}): Promise<CircuitJson> {
  if (loadBoard) return loadBoard()
  return renderBoard(boardTree!)
}

/** Include copper within one millimetre of each signal route in the debugger. */
const SCOPE_DISTANCE_MM = 1

/** Finish asset IO and TSX rendering before handing inputs to the debugger. */
async function loadBoardSolver({
  models,
  boardTree,
  loadBoard,
  signal,
  onReady,
}: {
  models: string[]
  boardTree?: BoardPageProps["board-tree"]
  loadBoard?: BoardPageProps["load-board"]
  signal: AbortSignal
  onReady: (solver: RoutedPipelineSolver) => void
}): Promise<void> {
  const ibisSources: IbisSources = {}
  for (const model of models) {
    const path = `models/${model}`
    if (ibisSources[path]) continue
    ibisSources[path] = await localAsset(model)
  }
  const circuitJson = await loadCircuitJson({ loadBoard, boardTree })
  if (signal.aborted) return
  const runSolver = createHttpSolver({ signal })
  for (const record of cju([...circuitJson]).simulation_ibis_model.list()) {
    const path = record.ibis_model_asset.project_relative_path
    ibisSources[path] ??= ibisSources[`models/${path.split("/").at(-1)}`]
  }
  const problem = {
    circuitJson,
    ibisSources,
    scopeDistanceMm: SCOPE_DISTANCE_MM,
  }
  onReady(
    new RoutedPipelineSolver({
      input: problem,
      context: {
        runSolver,
        progress: (): void => undefined,
      },
    }),
  )
}

type DebuggerSolver = NonNullable<GenericSolverDebuggerProps["solver"]>
type PublicDebuggerSolver = Omit<
  DebuggerSolver,
  "activeSubSolver" | "failedSubSolvers"
> & {
  activeSubSolver?: PublicDebuggerSolver | null
  failedSubSolvers?: PublicDebuggerSolver[]
}

/** The React entry declares its own copy of BaseSolver. Check its public shape without changing the instance. */
function asDebuggerSolver(solver: PublicDebuggerSolver): DebuggerSolver {
  return solver as DebuggerSolver
}

/** The debugger can select any of the six routed stages. */
const ROUTED_STAGE_COUNT = 6

/** Show a fixture's routed stages using the local ngspice HTTP execution port. */
export function BoardPage({
  "board-tree": boardTree,
  "load-board": loadBoard,
  models,
}: BoardPageProps): React.JSX.Element {
  const revision = useRef(0)
  const [step, setStep] = useState(0)
  const debuggerElement = useRef<HTMLElement>(null)
  const [ready, setReady] = useState<{
    solver: RoutedPipelineSolver
    revision: number
  }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!ready || !debuggerElement.current) return
    setStep(0)
    let iteration = ready.solver.iterations
    let index = ready.solver.currentPipelineStageIndex
    // solver-utils owns step actions and rerenders their progress; synchronize the input after each advance.
    const observer = new MutationObserver(() => {
      if (
        iteration === ready.solver.iterations &&
        index === ready.solver.currentPipelineStageIndex
      )
        return
      iteration = ready.solver.iterations
      index = ready.solver.currentPipelineStageIndex
      if (iteration === 0) return setStep(0)
      setStep(Math.min(index + 1, ROUTED_STAGE_COUNT))
    })
    observer.observe(debuggerElement.current, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return (): void => observer.disconnect()
  }, [ready])
  useEffect(() => {
    let cancelled = false
    void fetch("/api/solvers")
      .then(async (response) => {
        if (!response.ok) throw new Error("Local backend unavailable")
        const solvers = (await response.json()) as {
          ngspice: { available: boolean }
        }
        if (cancelled) return
        if (!solvers.ngspice.available) setError("ngspice not found on PATH")
      })
      .catch(() => {
        if (!cancelled) setError("Local ngspice backend unavailable")
      })
    return (): void => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setReady(undefined)
    setError(undefined)
    void loadBoardSolver({
      models,
      loadBoard,
      boardTree,
      signal: controller.signal,
      onReady: (solver) => setReady({ solver, revision: ++revision.current }),
    }).catch((cause: Error) => {
      if (controller.signal.aborted) return
      setError(cause.message)
    })
    return (): void => controller.abort()
  }, [boardTree, loadBoard, models])
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {ready && !error && (
        <section
          className="routed-debugger"
          ref={debuggerElement}
          onClick={(event) => {
            const target = event.target as HTMLElement
            if (target.closest("button, summary, a, input")) return
            const row = target.closest("tbody > tr")
            if (!row) return
            const index = Array.from(row.parentElement!.children).indexOf(row)
            if (index < 0 || index >= ROUTED_STAGE_COUNT) return
            setStep(index + 1)
          }}
        >
          <label className="step-selector">
            Step:{" "}
            <input
              aria-label="Step"
              type="number"
              min={0}
              max={ROUTED_STAGE_COUNT}
              step={1}
              value={step}
              onChange={(event) => {
                const enteredStep = event.currentTarget.valueAsNumber
                if (!Number.isFinite(enteredStep)) return setStep(0)
                setStep(
                  Math.min(
                    ROUTED_STAGE_COUNT,
                    Math.max(0, Math.trunc(enteredStep)),
                  ),
                )
              }}
            />
          </label>
          <GenericSolverDebugger
            key={ready.revision}
            customRenderer={{
              name: "Routed stage",
              render: () => renderStage({ root: ready.solver, number: step }),
              getDownload: () => ready.solver.visualizeStage(step),
            }}
            solver={asDebuggerSolver(ready.solver)}
          />
        </section>
      )}
    </>
  )
}

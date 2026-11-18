import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Circuit } from '@tscircuit/core'
import { GenericSolverDebugger, type GenericSolverDebuggerProps } from '@tscircuit/solver-utils/react'
import type { GraphicsObject, Viewbox } from 'graphics-debug'
import { createHttpSolver } from '../src/adapters/browser'
import { RoutedPipelineSolver } from '../src/pipeline'
import type { CircuitJson } from '../src/board'
// Imported directly: circuit-to-svg is a development dependency and never enters the library bundle.
import { boardPicture, boardPictureView } from '../src/board/board-picture'
import type { IbisSources } from '../src/buffers'

type AtlasMove = { x: number; y: number; zoom: number }

/** Zoom about the cursor only with ctrl/⌘, so the page still scrolls normally. */
function createAtlasWheelListener({
  element,
  base,
  setMove,
}: {
  element: HTMLDivElement
  base: React.RefObject<number>
  setMove: React.Dispatch<React.SetStateAction<AtlasMove>>
}): (event: WheelEvent) => void {
  return (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const box = element.getBoundingClientRect()
    setMove(({ x, y, zoom }) => {
      const next = Math.min(20 / base.current, Math.max(1 / base.current, zoom * Math.exp(-event.deltaY * 0.002)))
      const factor = next / zoom
      const pointerX = event.clientX - box.left
      const pointerY = event.clientY - box.top
      return { zoom: next, x: pointerX - (pointerX - x) * factor, y: pointerY - (pointerY - y) * factor }
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
}: { width: number; height: number; view: Viewbox; camera: Viewbox; move: AtlasMove }): Viewbox | undefined {
  const scale = Math.min(width / (view.maxX - view.minX), height / (view.maxY - view.minY))
  const left = (width - (view.maxX - view.minX) * scale) / 2
  const top = (height - (view.maxY - view.minY) * scale) / 2
  const minX = view.minX + ((0 - move.x) / move.zoom - left) / scale
  const maxX = view.minX + ((width - move.x) / move.zoom - left) / scale
  if (maxX - minX >= (camera.maxX - camera.minX) * 0.999) return
  return {
    minX,
    maxX,
    minY: view.maxY - ((height - move.y) / move.zoom - top) / scale,
    maxY: view.maxY - ((0 - move.y) / move.zoom - top) / scale,
  }
}

/**
 * The real board under the stage drawing at the container's width.
 * Ctrl/⌘ + wheel zooms (1–20×) and dragging pans; after a pause the zoomed region is re-rendered crisply.
 * Hovering a net, curve or mark dims everything else that is labelled and names it.
 */
function RoutedAtlas({ circuit, graphics }: { circuit: CircuitJson; graphics: GraphicsObject }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [region, setRegion] = useState<Viewbox>()
  const [move, setMove] = useState<AtlasMove>({ x: 0, y: 0, zoom: 1 })
  const [hover, setHover] = useState<{ label: string; x: number; y: number }>()
  const camera = boardPictureView(circuit, graphics)
  const view = region ?? camera
  const height = Math.round(Math.min(720, Math.max(360, (width * (camera.maxY - camera.minY)) / Math.max(camera.maxX - camera.minX, 1e-9))))
  // Zoom of the rendered region relative to the full camera; CSS zoom on top of it stays within 1–20× overall.
  const base = useRef(1)
  base.current = (camera.maxX - camera.minX) / (view.maxX - view.minX)
  useEffect(() => {
    const element = container.current!
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    const zoom = createAtlasWheelListener({ element, base, setMove })
    element.addEventListener('wheel', zoom, { passive: false })
    return (): void => {
      observer.disconnect()
      element.removeEventListener('wheel', zoom)
    }
  }, [])
  useEffect(() => {
    if (move.zoom === 1 && move.x === 0 && move.y === 0) return
    // Once interaction pauses, the visible part becomes the rendered region: sharp copper, same-size labels.
    const timer = setTimeout(() => {
      setRegion(zoomedRegion({ width, height, view, camera, move }))
      setMove({ x: 0, y: 0, zoom: 1 })
    }, 250)
    return (): void => clearTimeout(timer)
  }, [move])
  const picture = useMemo(() => {
    if (!(width > 0)) return
    return boardPicture({ circuit, drawing: graphics, width, height, region })
  }, [circuit, graphics, width, height, region])
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
        if (event.buttons === 1 && base.current * move.zoom > 1) setMove((move) => ({ ...move, x: move.x + event.movementX, y: move.y + event.movementY }))
        const label = (event.target as Element).closest?.('[data-label]')?.getAttribute('data-label')
        const box = container.current!.getBoundingClientRect()
        if (!label || label === 'camera') return setHover(undefined)
        setHover({ label, x: event.clientX - box.left, y: event.clientY - box.top })
      }}
      onPointerLeave={() => setHover(undefined)}
    >
      {picture && (
        <div className="routed-atlas-layers" style={{ transform: `translate(${move.x}px, ${move.y}px) scale(${move.zoom})` }}>
          <div dangerouslySetInnerHTML={{ __html: picture.board }} />
          <div dangerouslySetInnerHTML={{ __html: picture.overlay }} />
        </div>
      )}
      {hover && (
        <>
          <style>{`.routed-atlas-layers [data-label]:not([data-label=""]):not([data-label="camera"]):not([data-label=${JSON.stringify(hover.label)}]) { opacity: 0.2 }`}</style>
          <span className="routed-atlas-label" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.label}
          </span>
        </>
      )}
    </div>
  )
}

const drawings = new WeakMap<RoutedPipelineSolver, { key: string; graphics: GraphicsObject }>()

/** Draw a stage once per solver state. */
function stageDrawing(root: RoutedPipelineSolver, number: number): GraphicsObject {
  const solver = root.getSolver(root.pipelineDef[number - 1]?.solverName ?? '')
  const key = `${number}:${root.iterations}:${solver?.iterations}:${solver?.solved}:${solver?.failed}`
  const cached = drawings.get(root)
  if (cached?.key === key) return cached.graphics
  const graphics = root.visualizeStage(number)
  drawings.set(root, { key, graphics })
  return graphics
}

/** Render the stage with a fresh camera when the stage number changes. */
function renderStage(root: RoutedPipelineSolver, number: number): React.JSX.Element {
  const graphics = stageDrawing(root, number)
  return <RoutedAtlas key={number} circuit={root.inputProblem.circuitJson} graphics={graphics} />
}

export interface BoardPageProps {
  'board-tree'?: React.ReactElement
  'load-board'?: () => Promise<CircuitJson>
  models: string[]
}

/** Read a fixed local asset via the dev backend; vendor bytes stay outside the repository. */
export async function localAsset(name: string): Promise<string> {
  const response = await fetch(`/api/local-assets/${encodeURIComponent(name)}`)
  const body = (await response.json()) as { text?: string; error?: string }
  if (!response.ok || body.text === undefined) throw new Error(body.error ?? `missing local asset: ${name}`)
  return body.text
}

/** Render a TSX board's asset references and declarations. */
async function renderBoard(tree: React.ReactElement): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(tree)
  await circuit.renderUntilSettled()
  const records = circuit.getCircuitJson()
  const errors = records.filter((record) => record.type.endsWith('_error'))
  if (errors.length) throw new Error(JSON.stringify(errors))
  return records
}

/** Finish asset IO and TSX rendering before handing inputs to the debugger. */
async function loadBoardSolver({
  models,
  boardTree,
  loadBoard,
  signal,
  onReady,
}: {
  models: string[]
  boardTree?: BoardPageProps['board-tree']
  loadBoard?: BoardPageProps['load-board']
  signal: AbortSignal
  onReady: (solver: RoutedPipelineSolver) => void
}): Promise<void> {
  const ibisSources: IbisSources = {}
  for (const model of models) {
    const path = `models/${model}`
    if (ibisSources[path]) continue
    ibisSources[path] = await localAsset(model)
  }
  let circuitJson: CircuitJson
  if (loadBoard) circuitJson = await loadBoard()
  else circuitJson = await renderBoard(boardTree!)
  if (signal.aborted) return
  const runSolver = createHttpSolver({ signal })
  for (const record of circuitJson) {
    if (record.type !== 'simulation_ibis_model') continue
    const path = record.ibis_model_asset.project_relative_path
    ibisSources[path] ??= ibisSources[`models/${path.split('/').at(-1)}`]
  }
  onReady(new RoutedPipelineSolver({ circuitJson, ibisSources, scopeDistanceMm: 1 }, { runSolver, progress: (): void => undefined }))
}

type DebuggerSolver = NonNullable<GenericSolverDebuggerProps['solver']>
type PublicDebuggerSolver = Omit<DebuggerSolver, 'activeSubSolver' | 'failedSubSolvers'> & {
  activeSubSolver?: PublicDebuggerSolver | null
  failedSubSolvers?: PublicDebuggerSolver[]
}

/** The React entry declares its own copy of BaseSolver. Check its public shape without changing the instance. */
function asDebuggerSolver(solver: PublicDebuggerSolver): DebuggerSolver {
  return solver as DebuggerSolver
}

/** Show a fixture's routed stages using the local ngspice HTTP execution port. */
export function BoardPage({ 'board-tree': boardTree, 'load-board': loadBoard, models }: BoardPageProps): React.JSX.Element {
  const revision = useRef(0)
  const [step, setStep] = useState(0)
  const debuggerElement = useRef<HTMLElement>(null)
  const [ready, setReady] = useState<{ solver: RoutedPipelineSolver; revision: number }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!ready || !debuggerElement.current) return
    setStep(0)
    let iteration = ready.solver.iterations
    let index = ready.solver.currentPipelineStageIndex
    // solver-utils owns step actions and rerenders their progress; synchronize the input after each advance.
    const observer = new MutationObserver(() => {
      if (iteration === ready.solver.iterations && index === ready.solver.currentPipelineStageIndex) return
      iteration = ready.solver.iterations
      index = ready.solver.currentPipelineStageIndex
      if (iteration === 0) return setStep(0)
      setStep(Math.min(index + 1, 6))
    })
    observer.observe(debuggerElement.current, { childList: true, subtree: true, characterData: true })
    return (): void => observer.disconnect()
  }, [ready])
  useEffect(() => {
    let cancelled = false
    void fetch('/api/solvers')
      .then(async (response) => {
        if (!response.ok) throw new Error('Local backend unavailable')
        const solvers = (await response.json()) as { ngspice: { available: boolean } }
        if (cancelled) return
        if (!solvers.ngspice.available) setError('ngspice not found on PATH')
      })
      .catch(() => {
        if (!cancelled) setError('Local ngspice backend unavailable')
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
            if (target.closest('button, summary, a, input')) return
            const row = target.closest('tbody > tr')
            if (!row) return
            const index = Array.from(row.parentElement!.children).indexOf(row)
            if (index < 0 || index >= 6) return
            setStep(index + 1)
          }}
        >
          <label className="step-selector">
            Step:{' '}
            <input
              aria-label="Step"
              type="number"
              min={0}
              max={6}
              step={1}
              value={step}
              onChange={(event) => {
                const enteredStep = event.currentTarget.valueAsNumber
                if (!Number.isFinite(enteredStep)) return setStep(0)
                setStep(Math.min(6, Math.max(0, Math.trunc(enteredStep))))
              }}
            />
          </label>
          <GenericSolverDebugger
            key={ready.revision}
            customRenderer={{
              name: 'Routed stage',
              render: () => renderStage(ready.solver, step),
              getDownload: () => ready.solver.visualizeStage(step),
            }}
            solver={asDebuggerSolver(ready.solver)}
          />
        </section>
      )}
    </>
  )
}

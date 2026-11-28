import {
  CircuitToWebGpuDrawer,
  type Matrix,
} from "@tscircuit/circuit-json-webgpu"
import type { CircuitJson, LayerRef, Point } from "circuit-json"
import { type JSX, useEffect, useMemo, useRef, useState } from "react"
import { drawCopperEmphasis, pickCopper } from "./board-2d-copper"
import {
  boardElements,
  drawCanvasBoard,
  gpuLayers,
  uploadCircuit,
} from "./board-2d-renderer"
import type { BoardInteraction } from "./board-3d"
import type { InspectorBoard, InspectorFeature } from "./geometry"

/** Leave a margin around the fitted board and room to inspect individual pads. */
const FIT_RATIO = 0.92
const MAX_ZOOM = 32
const ZOOM_WHEEL_RATE = 500
const CLICK_SLOP = 3

/** Viewport scale relative to fit, with the center offset in CSS pixels. */
interface Camera2d {
  zoom: number
  offset: Point
}

const fittedCamera: Camera2d = { zoom: 1, offset: { x: 0, y: 0 } }

/** Track logical and backing dimensions independently for HiDPI picking. */
interface Viewport2d {
  width: number
  height: number
  pixelRatio: number
}

/** Set the physical backing size without resetting an unchanged drawing buffer. */
function resizeCanvas({
  canvas,
  viewport,
}: {
  canvas: HTMLCanvasElement
  viewport: Viewport2d
}): void {
  const width = Math.round(viewport.width * viewport.pixelRatio)
  const height = Math.round(viewport.height * viewport.pixelRatio)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
}

/** Fit with a y-up physical coordinate system and include HiDPI scaling. */
function cameraTransform({
  board,
  camera,
  viewport,
}: {
  board: InspectorBoard
  camera: Camera2d
  viewport: Viewport2d
}): Matrix {
  const { width, height, pixelRatio } = viewport
  const scale =
    Math.min(width / board.width, height / board.height) *
    FIT_RATIO *
    camera.zoom *
    pixelRatio
  return {
    a: scale,
    b: 0,
    c: 0,
    d: -scale,
    e: (width / 2 + camera.offset.x) * pixelRatio - board.center.x * scale,
    f: (height / 2 + camera.offset.y) * pixelRatio + board.center.y * scale,
  }
}

/** Invert the current camera for the status bar and the physical copper picker. */
function boardHit({
  point,
  surface,
  viewport,
  transform,
  activeLayer,
  onCursor,
  features,
}: {
  point: Point
  surface: HTMLCanvasElement
  viewport?: Viewport2d
  transform?: Matrix
  activeLayer?: LayerRef
  onCursor?: BoardInteraction["onCursor"]
  features: readonly InspectorFeature[]
}): InspectorFeature | undefined {
  if (!viewport || !transform) return
  const { x, y } = point
  const rect = surface.getBoundingClientRect()
  const pixels = {
    x: (x - rect.left) * viewport.pixelRatio,
    y: (y - rect.top) * viewport.pixelRatio,
  }
  const cursor = {
    x: (pixels.x - transform.e) / transform.a,
    y: (pixels.y - transform.f) / transform.d,
  }
  onCursor?.(cursor)
  return pickCopper({
    context: surface.getContext("2d")!,
    features,
    cursor,
    pixels,
    activeLayer,
    scale: transform.a / viewport.pixelRatio,
  })
}

/** Connect the retained PCB renderer to the Workbench's camera and copper tools. */
export function Board2d({
  board,
  circuit,
  hidden,
  features,
  layers,
  activeLayer,
  reset,
  hovered,
  selected,
  onHover,
  onSelect,
  onCursor,
  onContext,
}: BoardInteraction & {
  board: InspectorBoard
  circuit: CircuitJson
  hidden: ReadonlySet<string>
  features: readonly InspectorFeature[]
  layers: LayerRef[]
  activeLayer?: LayerRef
  reset: number
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ origin: Point; last: Point; moved: boolean }>(undefined)
  const [camera, setCamera] = useState(fittedCamera)
  const [viewport, setViewport] = useState<Viewport2d>()
  const [drawer, setDrawer] = useState<CircuitToWebGpuDrawer>()
  const [gpuFailure, setGpuFailure] = useState<string>()
  const [canvasFailure, setCanvasFailure] = useState<string>()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0)
        setViewport({ width, height, pixelRatio: window.devicePixelRatio })
    })
    observer.observe(host.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(
    () => setCamera(fittedCamera),
    [reset, board.center.x, board.center.y],
  )
  useEffect(() => {
    if (gpuFailure !== undefined) return
    let mounted = true
    let instance: CircuitToWebGpuDrawer | undefined
    void CircuitToWebGpuDrawer.create(canvas.current!, {
      renderViasInHighDetail: false,
      onDeviceLost: (message) => {
        if (mounted) setGpuFailure(message)
      },
    }).then(
      (created) => {
        if (!mounted) {
          created.dispose()
          return
        }
        instance = created
        setDrawer(created)
      },
      (error: Error) => {
        if (mounted) setGpuFailure(error.message)
      },
    )
    return () => {
      mounted = false
      instance?.dispose()
    }
  }, [gpuFailure])
  useEffect(() => {
    const target = overlay.current!
    /** Preserve the board point under the cursor while zooming. */
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const { left, top, width, height } = target.getBoundingClientRect()
      const x = event.clientX - left - width / 2
      const y = event.clientY - top - height / 2
      setCamera(({ zoom, offset }) => {
        const next = Math.min(
          MAX_ZOOM,
          Math.max(1, zoom * Math.exp(-event.deltaY / ZOOM_WHEEL_RATE)),
        )
        if (zoom === next) return { zoom, offset }
        const ratio = next / zoom
        return {
          zoom: next,
          offset: {
            x: x + (offset.x - x) * ratio,
            y: y + (offset.y - y) * ratio,
          },
        }
      })
    }
    target.addEventListener("wheel", wheel, { passive: false })
    return () => target.removeEventListener("wheel", wheel)
  }, [])
  const transform = useMemo(
    () => viewport && cameraTransform({ board, camera, viewport }),
    [board, camera, viewport],
  )
  const elements = useMemo(
    () => boardElements({ circuit, hidden }),
    [circuit, hidden],
  )
  const activeId = (hovered ?? selected)?.id
  useEffect(() => {
    if (!viewport || !transform || (!drawer && gpuFailure === undefined)) return
    const surface = canvas.current!
    resizeCanvas({ canvas: surface, viewport })
    if (gpuFailure !== undefined) {
      try {
        drawCanvasBoard({
          canvas: surface,
          elements,
          transform,
          layers,
          activeLayer,
        })
        setCanvasFailure(undefined)
        setReady(true)
      } catch (error) {
        setCanvasFailure((error as Error).message)
      }
      return
    }
    try {
      uploadCircuit({ drawer: drawer!, elements })
      drawer!.render({ ...gpuLayers({ layers, activeLayer }), transform })
      setReady(true)
    } catch (error) {
      setGpuFailure((error as Error).message)
    }
  }, [viewport, transform, drawer, gpuFailure, elements, layers, activeLayer])
  useEffect(() => {
    if (!viewport || !transform) return
    const surface = overlay.current!
    resizeCanvas({ canvas: surface, viewport })
    drawCopperEmphasis({
      context: surface.getContext("2d")!,
      features,
      transform,
      activeId,
    })
  }, [viewport, transform, features, activeId])

  const pickOptions = { viewport, transform, activeLayer, onCursor, features }

  return (
    <div className="wb-board-2d" ref={host}>
      <canvas
        key={gpuFailure === undefined ? "webgpu" : "canvas"}
        ref={canvas}
        className="wb-board-surface"
        data-renderer={gpuFailure === undefined ? "webgpu" : "canvas"}
        data-rendered={ready && !canvasFailure}
        aria-hidden="true"
      />
      <canvas
        ref={overlay}
        aria-label="Top view of PCB copper"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          const point = { x: event.clientX, y: event.clientY }
          drag.current = { origin: point, last: point, moved: false }
          onHover(undefined)
        }}
        onPointerMove={(event) => {
          const point = { x: event.clientX, y: event.clientY }
          const gesture = drag.current
          if (!gesture) {
            onHover(
              boardHit({ ...pickOptions, point, surface: event.currentTarget }),
            )
            return
          }
          if (
            !gesture.moved &&
            Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y) <
              CLICK_SLOP
          )
            return
          gesture.moved = true
          const { last } = gesture
          gesture.last = point
          setCamera(({ offset, zoom }) => ({
            zoom,
            offset: {
              x: offset.x + point.x - last.x,
              y: offset.y + point.y - last.y,
            },
          }))
        }}
        onPointerUp={(event) => {
          const gesture = drag.current
          drag.current = undefined
          if (!gesture || gesture.moved || event.button !== 0) return
          const feature = boardHit({
            ...pickOptions,
            point: { x: event.clientX, y: event.clientY },
            surface: event.currentTarget,
          })
          onHover(feature)
          onSelect(feature)
        }}
        onLostPointerCapture={() => {
          drag.current = undefined
        }}
        onPointerLeave={() => onHover(undefined)}
        onContextMenu={(event) => {
          event.preventDefault()
          const feature = boardHit({
            ...pickOptions,
            point: { x: event.clientX, y: event.clientY },
            surface: event.currentTarget,
          })
          if (feature)
            onContext?.({ feature, x: event.clientX, y: event.clientY })
        }}
      />
      {canvasFailure && (
        <small role="alert" className="wb-board-renderer">
          2D view unavailable. {canvasFailure}
        </small>
      )}
      {gpuFailure && !canvasFailure && (
        <small role="status" className="wb-board-renderer" title={gpuFailure}>
          Canvas renderer · {gpuFailure}
        </small>
      )}
    </div>
  )
}

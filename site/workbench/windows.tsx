import type { CSSProperties, JSX, PointerEvent, ReactNode } from "react"
import { useRef, useState } from "react"

import { CaptionIcon, Icon } from "./icons"

export const windowTitles = {
  start: "Start Page",
  board: "Board Viewer",
  stackup: "Stackup Editor",
  ibis: "Visual IBIS Editor",
  log: "Simulation Log",
  scope: "Oscilloscope",
} as const
export type WindowId = keyof typeof windowTitles

const windowIcons = {
  start: "app",
  board: "board",
  stackup: "stackup",
  ibis: "ibisCurve",
  log: "log",
  scope: "scope",
} as const

/** Position and activation state of one child window. */
export interface Frame {
  id: WindowId
  z: number
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  maximized: boolean
}

export type Arrange =
  | "Cascade"
  | "Tile Horizontally"
  | "Tile Vertically"
  | "Maximize"

/** Put a newly opened tool slightly below and right of the previous one. */
function newFrame({ id, count }: { id: WindowId; count: number }): Frame {
  if (id === "log")
    return {
      id,
      z: 0,
      x: 2,
      y: 69,
      width: 95,
      height: 29,
      minimized: false,
      maximized: false,
    }
  const offset = 2 + count * 3
  let height = 94 - offset
  if (id === "start") height = 58
  return {
    id,
    z: 0,
    x: offset,
    y: offset,
    width: 95 - offset,
    height,
    minimized: false,
    maximized: false,
  }
}

/** MDI child-window state and layout commands. */
export interface Windows {
  frames: Frame[]
  reset: () => void
  resetLayout: () => void
  arrangeIcons: () => void
  show: (id: WindowId) => void
  close: (id: WindowId) => void
  change: (frame: Frame) => void
  arrange: (mode: Arrange) => void
}

/** Keep activation order and percentage bounds independent of the tool contents. */
export function useWindows(): Windows {
  const [frames, setFrames] = useState<Frame[]>(() => [
    { ...newFrame({ id: "start", count: 0 }), z: 1 },
  ])
  return {
    frames,
    reset: () => setFrames([]),
    resetLayout: () =>
      setFrames((items) =>
        items.map((frame, count) => ({
          ...newFrame({ id: frame.id, count }),
          z: frame.z,
        })),
      ),
    arrangeIcons: () =>
      setFrames((items) =>
        items.map((frame) => {
          if (frame.minimized) return { ...frame, z: 0 }
          return frame
        }),
      ),
    show: (id) =>
      setFrames((items) => {
        const existing = items.find((frame) => frame.id === id)
        const next = existing ?? newFrame({ id, count: items.length })
        const activated = {
          ...next,
          minimized: false,
          z: Math.max(0, ...items.map(({ z }) => z)) + 1,
        }
        if (!existing) return [...items, activated]
        return items.map((frame) => (frame.id === id ? activated : frame))
      }),
    close: (id) =>
      setFrames((items) => items.filter((frame) => frame.id !== id)),
    change: (next) =>
      setFrames((items) =>
        items.map((frame) =>
          next.id === frame.id ? { ...next, z: frame.z } : frame,
        ),
      ),
    arrange: (mode) =>
      setFrames((items) => {
        const visible = items.filter((frame) => !frame.minimized)
        return items.map((frame) => {
          const index = visible.indexOf(frame)
          if (index < 0) return frame
          if (mode === "Cascade")
            return { ...newFrame({ id: frame.id, count: index }), z: frame.z }
          if (mode === "Maximize")
            return { ...frame, maximized: index === visible.length - 1 }
          const columns = mode === "Tile Vertically" ? visible.length : 1
          const rows = Math.ceil(visible.length / columns)
          return {
            ...frame,
            maximized: false,
            x: ((index % columns) * 100) / columns,
            y: (Math.floor(index / columns) * 100) / rows,
            width: 100 / columns,
            height: 100 / rows,
          }
        })
      }),
  }
}

const resizeEdges = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const
type ResizeEdge = (typeof resizeEdges)[number]

interface Gesture {
  frame: Frame
  clientX: number
  clientY: number
  edge?: ResizeEdge
  width: number
  height: number
}

/** Capture a title bar or resize grip until the current pointer gesture ends. */
function startGesture({
  event,
  frame,
  edge,
}: {
  event: PointerEvent<HTMLElement>
  frame: Frame
  edge?: ResizeEdge
}): Gesture | undefined {
  const workspace = event.currentTarget.closest(".wb-workspace")
  if (
    !workspace ||
    frame.maximized ||
    frame.minimized ||
    event.button !== 0 ||
    (event.target as HTMLElement).closest("button")
  )
    return
  event.currentTarget.setPointerCapture(event.pointerId)
  return {
    frame,
    clientX: event.clientX,
    clientY: event.clientY,
    edge,
    width: workspace.clientWidth,
    height: workspace.clientHeight,
  }
}

/** Convert a pointer gesture into clamped workspace percentages. */
function moveFrame({
  event,
  gesture,
}: {
  event: PointerEvent<HTMLElement>
  gesture: Gesture
}): Frame {
  const { frame, clientX, clientY, width, height, edge } = gesture
  const x = ((event.clientX - clientX) * 100) / width
  const y = ((event.clientY - clientY) * 100) / height
  if (edge) {
    const right = frame.x + frame.width
    const bottom = frame.y + frame.height
    const minWidth = Math.min(frame.width, 28)
    const minHeight = Math.min(frame.height, 24)
    let startX = frame.x
    let endX = right
    let startY = frame.y
    let endY = bottom
    if (edge.includes("w"))
      startX = Math.max(0, Math.min(right - minWidth, frame.x + x))
    if (edge.includes("e"))
      endX = Math.min(100, Math.max(frame.x + minWidth, right + x))
    if (edge.includes("n"))
      startY = Math.max(0, Math.min(bottom - minHeight, frame.y + y))
    if (edge.includes("s"))
      endY = Math.min(100, Math.max(frame.y + minHeight, bottom + y))
    return {
      ...frame,
      x: startX,
      y: startY,
      width: endX - startX,
      height: endY - startY,
    }
  }
  return {
    ...frame,
    x: Math.max(0, Math.min(100 - (24 * 100) / width, frame.x + x)),
    y: Math.max(0, Math.min(100 - (24 * 100) / height, frame.y + y)),
  }
}

/** Render a movable, resizable, minimizable MDI child. */
export function ChildWindow({
  frame,
  active,
  activate,
  close,
  change,
  children,
}: {
  frame: Frame
  active: boolean
  activate: () => void
  close: () => void
  change: (frame: Frame) => void
  children: ReactNode
}): JSX.Element {
  const gesture = useRef<Gesture>(undefined)
  const bounds: CSSProperties = frame.maximized
    ? { inset: 0 }
    : {
        left: `${frame.x}%`,
        top: `${frame.y}%`,
        width: `${frame.width}%`,
        height: `${frame.height}%`,
      }
  return (
    <section
      className="wb-child"
      data-window={frame.id}
      data-active={active}
      style={{ ...bounds, zIndex: frame.z }}
      hidden={frame.minimized}
      onPointerDown={() => {
        if (!active) activate()
      }}
    >
      <header
        className="wb-child-title"
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button"))
            change({ ...frame, maximized: !frame.maximized })
        }}
        onPointerDown={(event) => {
          gesture.current = startGesture({ event, frame })
        }}
        onPointerUp={() => {
          gesture.current = undefined
        }}
        onPointerCancel={() => {
          gesture.current = undefined
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1 && gesture.current)
            change(moveFrame({ event, gesture: gesture.current }))
        }}
      >
        <span className="wb-caption">
          <Icon name={windowIcons[frame.id]} />
          <span>{windowTitles[frame.id]}</span>
        </span>
        <div className="wb-title-buttons">
          <button
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => change({ ...frame, minimized: true })}
          >
            <CaptionIcon name="minimize" />
          </button>
          <button
            aria-label="Toggle maximize window"
            title="Maximize or restore"
            onClick={() => change({ ...frame, maximized: !frame.maximized })}
          >
            <CaptionIcon name={frame.maximized ? "restore" : "maximize"} />
          </button>
          <button aria-label="Close window" title="Close" onClick={close}>
            <CaptionIcon name="close" />
          </button>
        </div>
      </header>
      <div className="wb-child-body">{children}</div>
      {!frame.maximized &&
        resizeEdges.map((edge) => (
          <span
            key={edge}
            className="wb-resize"
            data-edge={edge}
            aria-hidden="true"
            onPointerDown={(event) => {
              gesture.current = startGesture({ event, frame, edge })
            }}
            onPointerUp={() => {
              gesture.current = undefined
            }}
            onPointerCancel={() => {
              gesture.current = undefined
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1 && gesture.current)
                change(moveFrame({ event, gesture: gesture.current }))
            }}
          />
        ))}
    </section>
  )
}

/** Keep minimized tools discoverable without remounting their contents. */
export function MinimizedWindows({
  frames,
  restore,
  close,
}: {
  frames: Frame[]
  restore: (id: WindowId) => void
  close: (id: WindowId) => void
}): JSX.Element {
  return (
    <div className="wb-minimized-strip">
      {frames
        .filter(({ minimized }) => minimized)
        .sort((a, b) => a.z - b.z)
        .map(({ id }) => (
          <div key={id} className="wb-child-title">
            <span className="wb-caption">
              <Icon name={windowIcons[id]} />
              <span>{windowTitles[id]}</span>
            </span>
            <div className="wb-title-buttons">
              <button
                title="Restore"
                aria-label={`Restore ${windowTitles[id]}`}
                onClick={() => restore(id)}
              >
                <CaptionIcon name="restore" />
              </button>
              <button
                title="Close"
                aria-label={`Close ${windowTitles[id]}`}
                onClick={() => close(id)}
              >
                <CaptionIcon name="close" />
              </button>
            </div>
          </div>
        ))}
    </div>
  )
}

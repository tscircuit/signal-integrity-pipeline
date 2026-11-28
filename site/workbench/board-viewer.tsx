import type { CircuitJson, LayerRef, Point } from "circuit-json"
import { type JSX, useEffect, useMemo, useState } from "react"
import { Board2d } from "../channel-inspector/board-2d"
import {
  Board3d,
  type BoardInteraction,
  type CameraView,
  cameraViews,
} from "../channel-inspector/board-3d"
import { copperCategories } from "../channel-inspector/copper"
import type {
  InspectorBoard,
  InspectorFeature,
} from "../channel-inspector/geometry"
import type { BoardAppearance } from "../channel-inspector/scene-geometry"
import type { Theme } from "./chrome"
import { fixed } from "./model/labels"

const allCopper = new Set<string>()

const categories = {
  selected: "Victim",
  near: "Near / aggressor",
  rail: "Rail",
  far: "Far",
}

/** Read the root CSS palette for the WebGL renderer. */
function boardAppearance({
  opacity,
  farOpacity,
}: {
  opacity: number
  farOpacity: number
}): BoardAppearance {
  const css = getComputedStyle(document.documentElement)
  return {
    background: css.getPropertyValue("--scene").trim(),
    grid: css.getPropertyValue("--scene-grid").trim(),
    glass: css.getPropertyValue("--glass").trim(),
    outline: css.getPropertyValue("--outline").trim(),
    highlight: css.getPropertyValue("--highlight").trim(),
    copper: {
      selected: css.getPropertyValue("--selected").trim(),
      near: css.getPropertyValue("--near").trim(),
      rail: css.getPropertyValue("--rail").trim(),
      far: css.getPropertyValue("--far").trim(),
    },
    opacity,
    farOpacity,
  }
}

/** Board controls shared by the viewer, context menu, and menu accelerators. */
export interface BoardView {
  mode: "3D" | "2D"
  setMode: (mode: "3D" | "2D") => void
  camera: CameraView
  chooseCamera: (camera: CameraView) => void
  fit: () => void
  reset: number
  hideFar: boolean
  setHideFar: (hide: boolean) => void
  transparent: boolean
  setTransparent: (transparent: boolean) => void
}

/** Keep viewer preferences alive while an MDI window is closed or recreated. */
export function useBoardView(): BoardView {
  const [mode, setMode] = useState<BoardView["mode"]>("3D")
  const [camera, setCamera] = useState<CameraView>("Iso")
  const [reset, setReset] = useState(0)
  const [hideFar, setHideFar] = useState(false)
  const [transparent, setTransparent] = useState(true)
  return {
    mode,
    setMode,
    camera,
    reset,
    hideFar,
    setHideFar,
    transparent,
    setTransparent,
    chooseCamera: (view) => {
      setMode("3D")
      setCamera(view)
      setReset((count) => count + 1)
    },
    fit: () => setReset((count) => count + 1),
  }
}

/** View the same selected, neighboring and reference copper in 2D and 3D. */
export function BoardViewer({
  board,
  circuit,
  features,
  theme,
  interaction,
  view,
  radiusMm,
  hoverLabel,
  error,
}: {
  board: InspectorBoard
  circuit: CircuitJson
  features: InspectorFeature[]
  theme: Theme
  interaction: BoardInteraction
  view: BoardView
  radiusMm: number
  hoverLabel?: string
  error?: string
}): JSX.Element {
  const {
    mode,
    setMode,
    camera,
    chooseCamera,
    fit,
    reset,
    hideFar,
    setHideFar,
    transparent,
  } = view
  const [exaggeration, setExaggeration] = useState(3)
  const [transparency, setTransparency] = useState(88)
  const [pointer, setPointer] = useState<Point>()
  const [hiddenLayers, setHiddenLayers] = useState<LayerRef[]>([])
  const [preferredLayer, setPreferredLayer] = useState<LayerRef>("top")
  const farOpacity = theme === "classic" ? 0.24 : 0.15
  const opacity = transparent ? (100 - transparency) / 100 : 1
  const [appearance, setAppearance] = useState<BoardAppearance>(() =>
    boardAppearance({ opacity, farOpacity }),
  )
  useEffect(
    () => setAppearance(boardAppearance({ opacity, farOpacity })),
    [theme, opacity, farOpacity],
  )
  const visibleLayers = useMemo(
    () => board.layers.filter((layer) => !hiddenLayers.includes(layer)),
    [board, hiddenLayers],
  )
  let activeLayer = visibleLayers[0]
  if (visibleLayers.includes(preferredLayer)) activeLayer = preferredLayer
  const hiddenCopper = useMemo(() => {
    if (!hideFar) return allCopper
    return new Set(
      features.filter(({ category }) => category === "far").map(({ id }) => id),
    )
  }, [features, hideFar])
  const visibleBoard = useMemo(
    () => ({
      ...board,
      components: board.components.filter(({ layer }) =>
        visibleLayers.includes(layer),
      ),
    }),
    [board, visibleLayers],
  )
  const visible = useMemo(
    () =>
      features
        .filter(({ category }) => !hideFar || category !== "far")
        .map((feature) => ({
          ...feature,
          shapes: feature.shapes.flatMap((shape) => {
            const layers = shape.layers.filter((layer) =>
              visibleLayers.includes(layer),
            )
            if (!layers.length) return []
            return [{ ...shape, layers }]
          }),
        })),
    [features, hideFar, visibleLayers],
  )
  return (
    <div className="wb-board">
      <div className="wb-tool-row">
        {(["3D", "2D"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {value}
          </button>
        ))}
        {mode === "3D" && (
          <>
            <span className="wb-separator" />
            {cameraViews.map((view) => (
              <button
                key={view}
                aria-pressed={camera === view}
                onClick={() => chooseCamera(view)}
              >
                {view}
              </button>
            ))}
            <label>
              Exaggeration{" "}
              <input
                type="range"
                min="1"
                max="14"
                value={exaggeration}
                onChange={(event) =>
                  setExaggeration(event.target.valueAsNumber)
                }
              />{" "}
              {exaggeration}×
            </label>
            <label>
              Transparency{" "}
              <input
                type="range"
                min="20"
                max="100"
                disabled={!transparent}
                value={transparency}
                onChange={(event) =>
                  setTransparency(event.target.valueAsNumber)
                }
              />{" "}
              {transparency}%
            </label>
          </>
        )}
        <button onClick={fit}>Fit</button>
      </div>
      <div className="wb-tool-row wb-layer-strip">
        {mode === "2D" && (
          <label>
            Active layer
            <select
              value={activeLayer ?? ""}
              disabled={!activeLayer}
              onChange={(event) =>
                setPreferredLayer(event.target.value as LayerRef)
              }
            >
              {!activeLayer && <option value="">None</option>}
              {visibleLayers.map((layer) => (
                <option key={layer}>{layer}</option>
              ))}
            </select>
          </label>
        )}
        <strong>Layers</strong>
        {board.layers.map((layer) => (
          <label key={layer}>
            <input
              type="checkbox"
              checked={visibleLayers.includes(layer)}
              onChange={(event) => {
                const checked = event.target.checked
                setHiddenLayers((items) =>
                  checked
                    ? items.filter((item) => item !== layer)
                    : [...items, layer],
                )
              }}
            />{" "}
            {layer}
          </label>
        ))}
        <span className="wb-separator" />
        <label>
          <input
            type="checkbox"
            checked={hideFar}
            onChange={(event) => setHideFar(event.target.checked)}
          />{" "}
          Hide far
        </label>
      </div>
      {error && (
        <div role="alert" className="wb-inline-error">
          {error}
        </div>
      )}
      <div
        className="wb-board-stage"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setPointer({
            x: Math.min(
              event.clientX - rect.left + 12,
              Math.max(0, rect.width - 155),
            ),
            y: Math.min(event.clientY - rect.top + 14, rect.height - 25),
          })
        }}
        onPointerLeave={() => setPointer(undefined)}
      >
        <div hidden={mode !== "3D"} className="wb-board-3d">
          <Board3d
            board={visibleBoard}
            features={visible}
            view={camera}
            cameraReset={reset}
            exaggeration={exaggeration}
            appearance={appearance}
            {...interaction}
          />
        </div>
        {mode === "2D" && (
          <Board2d
            board={board}
            circuit={circuit}
            hidden={hiddenCopper}
            features={visible}
            layers={visibleLayers}
            activeLayer={activeLayer}
            reset={reset}
            {...interaction}
          />
        )}
        {pointer && hoverLabel && (
          <small
            className="wb-board-tip"
            role="tooltip"
            style={{ left: pointer.x, top: pointer.y }}
          >
            {hoverLabel}
          </small>
        )}
        <small className="wb-board-hint">
          {mode === "3D" ? "Drag to orbit" : "Drag to pan"} · Scroll to zoom ·
          Right-click copper
        </small>
      </div>
      <div className="wb-tool-row wb-board-legend" aria-label="Copper legend">
        {copperCategories.map((category) => (
          <span className="wb-legend-item" key={category}>
            {mode === "3D" && (
              <i style={{ background: `var(--${category})` }} />
            )}
            {categories[category]}{" "}
            <strong>
              {
                features.filter((feature) => feature.category === category)
                  .length
              }
            </strong>
          </span>
        ))}
        <span>Radius: {Number(radiusMm.toFixed(3))} mm</span>
      </div>
    </div>
  )
}

/** Format board coordinates consistently in the desktop status bar. */
export function boardCoordinates(point?: Point): string {
  if (!point) return "X — mm · Y — mm"
  return `X ${fixed({ value: point.x, digits: 2 })} · Y ${fixed({ value: point.y, digits: 2 })} mm`
}

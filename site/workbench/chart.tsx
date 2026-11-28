import {
  type JSX,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { roundTicks } from "../../src/simulation/waveform-visual"
import "./chart.css"

export type Datum = [x: number, y: number]
export interface Series {
  id: string
  label: string
  points: Datum[]
  color: number
  dashed?: boolean
  opacity?: number
}
export interface ChartBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

const dimensions = {
  width: 720,
  height: 360,
  left: 54,
  right: 704,
  top: 25,
  bottom: 318,
}
/** One axis projected between its data and screen endpoints. */
interface Axis {
  low: number
  high: number
  from: number
  to: number
}

/** Project a sample position onto one axis of the graticule. */
function projectAxis(axis: Axis): (value: number) => number {
  return (value) =>
    axis.from +
    ((axis.to - axis.from) * (value - axis.low)) / (axis.high - axis.low)
}

/** Resolve pointer input in SVG space even when the MDI window is resized. */
function cursorAt({
  event,
  axis,
}: {
  event: PointerEvent<SVGSVGElement>
  axis: Axis
}): number {
  const matrix = event.currentTarget.getScreenCTM()
  const pointer = new DOMPoint(event.clientX, event.clientY)
  const { x } = matrix ? pointer.matrixTransform(matrix.inverse()) : pointer
  return (
    axis.low +
    (axis.high - axis.low) *
      Math.max(0, Math.min(1, (x - axis.from) / (axis.to - axis.from)))
  )
}

/** Find plot bounds in one pass without expanding long captures onto the call stack. */
function seriesBounds(series: Series[]): ChartBounds | undefined {
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const line of series)
    for (const [x, y] of line.points) {
      xMin = Math.min(xMin, x)
      xMax = Math.max(xMax, x)
      yMin = Math.min(yMin, y)
      yMax = Math.max(yMax, y)
    }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return
  const margin = (yMax - yMin || 1) * 0.06
  return {
    xMin,
    xMax: xMin === xMax ? xMin + 1 : xMax,
    yMin: yMin - margin,
    yMax: yMax + margin,
  }
}

/** Return a CSS series color shared by SVGs and legends. */
export function seriesColor(index: number): string {
  return `var(--series-${(index % 6) + 1})`
}

/** Interpolate a monotonic series at an arbitrary cursor coordinate. */
export function sampleAt({
  points,
  x,
}: {
  points: Datum[]
  x: number
}): number | undefined {
  if (!points.length || x < points[0][0] || x > points.at(-1)![0]) return
  let low = 0
  let high = points.length - 1
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (points[middle][0] <= x) low = middle
    else high = middle
  }
  const [x0, y0] = points[low]
  const [x1, y1] = points[high]
  if (x0 === x1) return y0
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
}

interface ChartCursor {
  label: "A" | "B"
  value: number
  move: (x: number) => void
}
interface ChartMask {
  points: Datum[]
  failed: boolean
}

/** A themed SVG graticule with x zoom, readout, and optional draggable instrument cursors. */
export function Chart({
  series,
  bounds,
  title,
  xUnit,
  yUnit,
  cursors = [],
  mask,
  threshold,
  scope = false,
  onHover,
}: {
  series: Series[]
  bounds?: ChartBounds
  title: string
  xUnit: string
  yUnit: string
  cursors?: ChartCursor[]
  mask?: ChartMask
  threshold?: number
  scope?: boolean
  onHover?: (x?: number) => void
}): JSX.Element {
  const clip = useId()
  const element = useRef<SVGSVGElement>(null)
  const [viewport, setViewport] = useState({
    width: dimensions.width,
    height: dimensions.height,
  })
  const hasData =
    bounds !== undefined || series.some(({ points }) => points.length > 0)
  useEffect(() => {
    if (!hasData || !element.current) return
    const observer = new ResizeObserver(([{ contentRect }]) => {
      if (contentRect.width > 0 && contentRect.height > 0)
        setViewport({
          width: Math.max(118, contentRect.width),
          height: Math.max(120, contentRect.height),
        })
    })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [hasData])
  const [zoom, setZoom] = useState<[number, number]>()
  const [drag, setDrag] = useState<{ start: number; end: number }>()
  const [marker, setMarker] = useState<number>()
  const [activeCursor, setActiveCursor] = useState<ChartCursor["label"]>()
  const domain = bounds ?? seriesBounds(series)
  if (!domain) return <p className="wb-plot-empty">No samples for {title}.</p>
  const { width, height } = viewport
  const { left, top } = dimensions
  const right = width - (dimensions.width - dimensions.right)
  const bottom = height - (dimensions.height - dimensions.bottom)
  const [xMin, xMax] = zoom ?? [domain.xMin, domain.xMax]
  const { yMin, yMax } = domain
  const xAxis = { low: xMin, high: xMax, from: left, to: right }
  const xAt = projectAxis(xAxis)
  const yAt = projectAxis({ low: yMin, high: yMax, from: bottom, to: top })
  const ticks = roundTicks({
    low: xMin,
    high: xMax,
    count: Math.max(2, Math.floor((right - left) / 54)),
  })
  const levels = roundTicks({
    low: yMin,
    high: yMax,
    count: Math.max(1, Math.floor((bottom - top) / 24)),
  })
  return (
    <svg
      className="wb-chart"
      ref={element}
      data-scope={scope}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      onDoubleClick={() => setZoom(undefined)}
      onPointerLeave={() => {
        setMarker(undefined)
        onHover?.()
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const grabbed = (event.target as SVGElement)
          .closest("[data-cursor]")
          ?.getAttribute("data-cursor")
        const x = cursorAt({ event, axis: xAxis })
        event.currentTarget.setPointerCapture(event.pointerId)
        if (grabbed === "A" || grabbed === "B") setActiveCursor(grabbed)
        else setDrag({ start: x, end: x })
      }}
      onPointerMove={(event) => {
        const x = cursorAt({ event, axis: xAxis })
        setMarker(x)
        onHover?.(x)
        if (activeCursor)
          cursors.find(({ label }) => label === activeCursor)?.move(x)
        if (drag) setDrag({ ...drag, end: x })
      }}
      onPointerUp={() => {
        if (drag && Math.abs(drag.start - drag.end) > (xMax - xMin) / 48)
          setZoom([
            Math.min(drag.start, drag.end),
            Math.max(drag.start, drag.end),
          ])
        setDrag(undefined)
        setActiveCursor(undefined)
      }}
      onPointerCancel={() => {
        setDrag(undefined)
        setActiveCursor(undefined)
      }}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={left} y={top} width={right - left} height={bottom - top} />
        </clipPath>
      </defs>
      {ticks.map(({ value, text }) => {
        const x = xAt(value)
        return (
          <g key={text}>
            <line className="wb-plot-grid" x1={x} x2={x} y1={top} y2={bottom} />
            <text textAnchor="middle" x={x} y={bottom + 17}>
              {text}
            </text>
          </g>
        )
      })}
      {levels.map(({ value, text }) => {
        const y = yAt(value)
        return (
          <g key={text}>
            <line className="wb-plot-grid" x1={left} x2={right} y1={y} y2={y} />
            <text textAnchor="end" x={left - 5} y={y + 3}>
              {text}
            </text>
          </g>
        )
      })}
      <rect
        className="wb-chart-frame"
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
      />
      <text textAnchor="middle" x={(left + right) / 2} y={height - 4}>
        {xUnit}
      </text>
      <text x={left} y={top - 9}>
        {yUnit}
      </text>
      <g clipPath={`url(#${clip})`}>
        {threshold !== undefined && (
          <line
            className="wb-chart-threshold"
            x1={left}
            x2={right}
            y1={yAt(threshold)}
            y2={yAt(threshold)}
          />
        )}
        {series.map(({ id, points, color, dashed, opacity }) => (
          <polyline
            key={id}
            points={points
              .map(([x, y]) => `${xAt(x).toFixed(2)},${yAt(y).toFixed(2)}`)
              .join(" ")}
            fill="none"
            stroke={seriesColor(color)}
            strokeWidth="1.5"
            strokeDasharray={dashed ? "4 3" : undefined}
            opacity={opacity ?? (dashed ? 0.65 : 1)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {mask && (
          <polygon
            className="wb-eye-mask"
            data-failed={mask.failed}
            points={mask.points
              .map(([x, y]) => `${xAt(x)},${yAt(y)}`)
              .join(" ")}
          />
        )}
        {marker !== undefined && (
          <line
            className="wb-chart-marker"
            x1={xAt(marker)}
            x2={xAt(marker)}
            y1={top}
            y2={bottom}
          />
        )}
        {drag && (
          <rect
            className="wb-chart-zoom"
            x={xAt(Math.min(drag.start, drag.end))}
            y={top}
            width={Math.abs(xAt(drag.start) - xAt(drag.end))}
            height={bottom - top}
          />
        )}
      </g>
      {cursors
        .filter(({ value }) => value >= xMin && value <= xMax)
        .map(({ label, value }) => {
          const x = xAt(value)
          return (
            <g className="wb-chart-cursor" data-cursor={label} key={label}>
              <line
                x1={x}
                x2={x}
                y1={top}
                y2={bottom}
                strokeWidth="10"
                stroke="transparent"
              />
              <line
                x1={x}
                x2={x}
                y1={top}
                y2={bottom}
                className="wb-cursor-line"
              />
              <rect x={x - 8} y={top - 16} width="16" height="14" />
              <text x={x} y={top - 5} textAnchor="middle">
                {label}
              </text>
            </g>
          )
        })}
    </svg>
  )
}

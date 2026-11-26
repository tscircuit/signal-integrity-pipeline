import type { GraphicsObject, Text } from "graphics-debug"
import {
  estimateTextWidthEms,
  PLAN_BAND_GAP,
  PLAN_LINE_STEP,
  wrapPlanText,
} from "../../src/board/plan-header"
import { getPointBounds } from "../../src/board/plan-view"

/** Balance a two-line caption around its midpoint without breaking words. */
function captionLines({
  text,
  maxWidthEms,
}: {
  text: string
  maxWidthEms: number
}): string[] {
  const wrapped = wrapPlanText({ text, maxWidthEms })
  if (wrapped.length !== 2) return wrapped
  const words = text.split(" ")
  let best = wrapped[0].length
  let difference = Math.abs(
    estimateTextWidthEms(wrapped[0]) - estimateTextWidthEms(wrapped[1]),
  )
  let end = 0
  for (const word of words.slice(0, -1)) {
    end += word.length
    const left = estimateTextWidthEms(text.slice(0, end))
    const right = estimateTextWidthEms(text.slice(end + 1))
    const gap = Math.abs(left - right)
    if (Math.max(left, right) <= maxWidthEms && gap < difference) {
      best = end
      difference = gap
    }
    end++
  }
  return [text.slice(0, best), text.slice(best + 1)]
}

/** Add the fixture's explanation and extend the plan picture below the board. */
export function withPlanCaption({
  drawing,
  caption,
}: {
  drawing: GraphicsObject
  caption: string
}): GraphicsObject {
  const frame = drawing.rects?.find(({ layer }) => layer === "frame")
  const header = drawing.texts?.find(({ layer }) => layer === "header")
  if (frame === undefined || header?.fontSize === undefined)
    throw new Error("A test caption requires a framed plan drawing")
  const { fontSize: size, color } = header

  const board = getPointBounds([
    ...(drawing.polygons || []).flatMap(({ points }) => points),
    ...(drawing.lines || [])
      .filter(({ layer }) => layer !== "header")
      .flatMap(({ points }) => points),
    ...(drawing.texts || []).filter(({ layer }) => layer !== "header"),
  ])
  if (board === undefined) throw new Error("The plan drawing has no board")

  const x = frame.center.x
  const firstY = board.minY - size * (PLAN_BAND_GAP + 0.5)
  const texts = captionLines({
    text: caption,
    maxWidthEms: frame.width / size,
  }).map(
    (text, i): Text => ({
      x,
      y: firstY - size * PLAN_LINE_STEP * i,
      text,
      anchorSide: "center",
      fontSize: size,
      color,
      layer: "test caption",
    }),
  )
  const last = texts.at(-1)
  if (last === undefined) throw new Error("The test caption has no text")
  const top = frame.center.y + frame.height / 2
  const bottom = last.y - size
  return {
    ...drawing,
    texts: [...(drawing.texts || []), ...texts],
    rects: drawing.rects?.map((rect) => {
      if (rect !== frame) return rect
      return {
        ...rect,
        center: { x, y: (top + bottom) / 2 },
        height: top - bottom,
      }
    }),
  }
}

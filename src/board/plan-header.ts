import type { Line, Rect, Text } from "graphics-debug"
import type { PlanFrame } from "./plan-view"
import { type PlanVisualDiagnostic, planColors } from "./plan-visual-types"

/** One centered line of the plan header. */
export interface PlanHeaderRow {
  text: string
  color?: string
}

/** Data needed to frame the header, independent of the copper drawing. */
interface PlanHeaderScene {
  title: string
  diagnostic?: PlanVisualDiagnostic
  rows: readonly PlanHeaderRow[]
}

/** Primitives reserved above the highest board mark. */
interface PlanHeader {
  lines: Line[]
  rects: Rect[]
  texts: Text[]
}

/** Keep secondary text proportional to the physical board width. */
const BOARD_WIDTH_IN_TEXT_UNITS = 52
/** Gap between the board and its surrounding text bands, in text-size units. */
export const PLAN_BAND_GAP = 1.54
/** Vertical spacing of consecutive text rows, in text-size units. */
export const PLAN_LINE_STEP = 1.31
/** Readable scale-bar lengths in millimetres. */
const SCALE_LENGTHS_MM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]

/** Pick a standard length near one eighth of the drawn width. */
function getScaleLengthMm(widthMm: number): number {
  const targetLengthMm = widthMm / 8
  return SCALE_LENGTHS_MM.reduce((best, length) => {
    if (
      Math.abs(Math.log(length / targetLengthMm)) <
      Math.abs(Math.log(best / targetLengthMm))
    )
      return length
    return best
  })
}

/** Use the same secondary text size for header lines and board labels. */
export function getPlanTextSizeMm(widthMm: number): number {
  return widthMm / BOARD_WIDTH_IN_TEXT_UNITS
}

/** Estimate sans-serif glyph widths in ems for the header and board labels. */
export function estimateTextWidthEms(text: string): number {
  let widthEms = 0
  for (const char of text) {
    if (" .,:;!'ijlI|·".includes(char)) widthEms += 0.34
    else if ("mwMW@".includes(char) || char > "~") widthEms += 1
    else if (char.toUpperCase() === char) widthEms += 0.74
    else widthEms += 0.61
  }
  return widthEms
}

/** Wrap at spaces and split individual words only when they exceed the frame. */
export function wrapPlanText({
  text,
  maxWidthEms,
}: {
  text: string
  maxWidthEms: number
}): string[] {
  const lines: string[] = []
  let line = ""
  for (let word of text.split(" ")) {
    if (estimateTextWidthEms(line + word) <= maxWidthEms) {
      line += `${word} `
      continue
    }
    if (line) lines.push(line.trimEnd())
    while (estimateTextWidthEms(word) > maxWidthEms) {
      let end = 1
      while (estimateTextWidthEms(word.slice(0, end + 1)) <= maxWidthEms) end++
      lines.push(word.slice(0, end))
      word = word.slice(end)
    }
    line = `${word} `
  }
  if (line.trimEnd()) lines.push(line.trimEnd())
  return lines
}

/** A wrapped header row with its font size and optional hover diagnostic. */
interface SizedHeaderRow extends PlanHeaderRow {
  fontSizeMm: number
  label?: string
}

/** Wrap the summary and append the legend at a size that fits one row. */
function buildHeaderRows({
  scene,
  fontSizeMm,
  widthMm,
  legend,
}: {
  scene: PlanHeaderScene
  fontSizeMm: number
  widthMm: number
  legend: readonly string[]
}): SizedHeaderRow[] {
  let titleColor: string = planColors.ink
  if (scene.diagnostic) titleColor = planColors.failure
  const rows = [
    {
      text: scene.title,
      color: titleColor,
      fontSizeMm: fontSizeMm * 1.32,
    },
    {
      text: scene.diagnostic?.text,
      color: planColors.failure,
      fontSizeMm,
      label: scene.diagnostic?.label,
    },
    ...scene.rows.map((row) => ({ ...row, fontSizeMm })),
  ]
  const wrapped = rows.flatMap((row) => {
    if (!row.text) return []
    return wrapPlanText({
      text: row.text,
      maxWidthEms: widthMm / row.fontSizeMm,
    }).map((text) => ({
      ...row,
      text,
    }))
  })
  const legendText = legend.join(" · ")
  if (legendText)
    wrapped.push({
      text: legendText,
      color: planColors.quiet,
      fontSizeMm: Math.min(
        fontSizeMm,
        widthMm / estimateTextWidthEms(legendText),
      ),
    })
  return wrapped
}

/** Center each line above the board at its normal reading size. */
export function buildPlanHeader({
  scene,
  frame,
  boardTopMm,
  legend,
}: {
  scene: PlanHeaderScene
  frame: PlanFrame
  boardTopMm: number
  legend: readonly string[]
}): PlanHeader {
  const { widthMm, box } = frame
  const x = (box.minX + box.maxX) / 2
  const fontSizeMm = getPlanTextSizeMm(widthMm)
  const scaleLengthMm = getScaleLengthMm(widthMm)
  const scaleYMm = boardTopMm + fontSizeMm * PLAN_BAND_GAP
  const labelYMm = scaleYMm + fontSizeMm * 0.88
  const lines: Line[] = [
    {
      points: [
        { x: x - scaleLengthMm / 2, y: scaleYMm + fontSizeMm * 0.23 },
        { x: x - scaleLengthMm / 2, y: scaleYMm },
        { x: x + scaleLengthMm / 2, y: scaleYMm },
        { x: x + scaleLengthMm / 2, y: scaleYMm + fontSizeMm * 0.23 },
      ],
      strokeColor: planColors.quiet,
      strokeWidth: fontSizeMm * 0.085,
      label: `${scaleLengthMm} mm`,
      layer: "header",
    },
  ]
  const texts: Text[] = [
    {
      x,
      y: labelYMm,
      text: `${scaleLengthMm} mm`,
      anchorSide: "center",
      fontSize: fontSizeMm,
      color: planColors.quiet,
      layer: "header",
    },
  ]
  const rects: Rect[] = []
  let y = labelYMm + fontSizeMm * 1.66
  const rows = buildHeaderRows({ scene, fontSizeMm, widthMm, legend })
  for (const row of rows.reverse()) {
    texts.push({
      x,
      y,
      text: row.text,
      color: row.color || planColors.ink,
      fontSize: row.fontSizeMm,
      anchorSide: "center",
      layer: "header",
    })
    if ("label" in row && row.label)
      rects.push({
        center: { x, y },
        width: estimateTextWidthEms(row.text) * row.fontSizeMm,
        height: fontSizeMm * 1.25,
        fill: "transparent",
        stroke: "none",
        label: row.label,
        layer: "header",
      })
    y += row.fontSizeMm * PLAN_LINE_STEP
  }
  const top = y + fontSizeMm * 0.3
  const bottom = box.minY - fontSizeMm * 0.9
  rects.push({
    center: { x, y: (top + bottom) / 2 },
    width: widthMm + fontSizeMm * 3.6,
    height: top - bottom,
    fill: "none",
    stroke: "none",
    layer: "frame",
  })
  return { texts, rects, lines }
}

import { toSvg } from "html-to-image"
import type { InspectorInput } from "../channel-inspector/input"
import type { SimulationRun } from "./local-run"
import { withStimulusRadius } from "./model/stimulus"
import rangeCss from "./ranges.css?raw"

/** Kick off a local download, then release its temporary URL. */
export function downloadBlob({
  filename,
  blob,
}: {
  filename: string
  blob: Blob
}): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Export the exact edited record array, including embedded models and channel parameters. */
export function exportDesign(input: InspectorInput): void {
  let name = input.name
  if (name.endsWith(".json")) name = name.slice(0, -".json".length)
  if (name.endsWith(".circuit")) name = name.slice(0, -".circuit".length)
  const records = input.circuit.map((record) => {
    if (record.type !== "simulation_pcb_transient_channel_simulation")
      return record
    return withStimulusRadius({
      simulation: record,
      defaultMm: input.distanceMm,
    })
  })
  const blob = new Blob([`${JSON.stringify(records, null, 2)}\n`], {
    type: "application/json",
  })
  downloadBlob({ filename: `${name}.circuit.json`, blob })
}

/** Quote a probe label for a standards-compatible CSV header. */
function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Export original adaptive timestamps and each native voltage vector. */
export function exportWaveforms(run: SimulationRun): void {
  const { probes, timestampsSeconds } = run.capture
  const lines = [
    [
      "time_s",
      ...probes.map(({ name }) => {
        const metadata = run.probes[name]
        let label = name
        if (metadata)
          label = `${metadata.name}_${metadata.isDriver ? "driver" : "receiver"}_${name}`
        return csvCell(`${label}_V`)
      }),
    ].join(","),
  ]
  for (const [index, time] of timestampsSeconds.entries())
    lines.push(
      [time, ...probes.map(({ voltageLevels }) => voltageLevels[index])].join(
        ",",
      ),
    )
  downloadBlob({
    filename: `waveforms-run-${run.id}.csv`,
    blob: new Blob([`${lines.join("\n")}\n`], { type: "text/csv" }),
  })
}

// html-to-image deep-clones SVG roots, so descendant stylesheet rules must be materialized.
const svgPaint = [
  "background-color",
  "color",
  "fill",
  "fill-opacity",
  "font-family",
  "font-size",
  "font-variant-numeric",
  "font-weight",
  "opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
]

/** Apply the same pseudo-element track and thumb styling in the serialized window. */
function resolveSliderStyles({
  element,
  copy,
}: {
  element: HTMLElement
  copy: SVGForeignObjectElement
}): void {
  if (!copy.querySelector('input[type="range"]')) return
  const root = copy.firstElementChild as HTMLElement
  const computed = getComputedStyle(element)
  root.classList.add("wb-snapshot")
  for (const property of [
    "--btn-bg",
    "--edge",
    "--surface",
    "--shadow",
    "--light",
  ])
    root.style.setProperty(property, computed.getPropertyValue(property))
  const style = copy.ownerDocument.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "style",
  )
  style.textContent = rangeCss
  root.prepend(style)
}

/** Carry resolved SVG paint and live input states into the serialized window. */
function resolveSnapshot({
  element,
  svg,
}: {
  element: HTMLElement
  svg: string
}): string {
  const xml = decodeURIComponent(svg.slice(svg.indexOf(",") + 1))
  const snapshot = new DOMParser().parseFromString(xml, "image/svg+xml")
  const copy = snapshot.querySelector("foreignObject")!
  const nodes = element.querySelectorAll("svg, svg *")
  copy
    .querySelectorAll<SVGElement>(":scope svg, :scope svg *")
    .forEach((node, index) => {
      const computed = getComputedStyle(nodes[index])
      for (const property of svgPaint)
        node.style.setProperty(property, computed.getPropertyValue(property))
    })
  const inputs = element.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"],input[type="radio"]',
  )
  copy
    .querySelectorAll('input[type="checkbox"],input[type="radio"]')
    .forEach((node, index) => {
      node.toggleAttribute("checked", inputs[index].checked)
    })
  resolveSliderStyles({ element, copy })
  const encoded = encodeURIComponent(
    new XMLSerializer().serializeToString(snapshot),
  )
  return `data:image/svg+xml;charset=utf-8,${encoded}`
}

/** Rasterize the active MDI frame and its rendered SVG or WebGL content locally. */
export async function exportWindow(name: string): Promise<void> {
  const element = document.querySelector<HTMLElement>(`[data-window="${name}"]`)
  if (!element || element.hidden)
    throw new Error("Open the window before exporting it.")
  const { offsetWidth: width, offsetHeight: height } = element
  const svg = await toSvg(element, {
    width,
    height,
    skipFonts: true,
    style: {
      boxSizing: "border-box",
      margin: "0",
      boxShadow: "none",
      left: "0",
      top: "0",
      position: "static",
    },
  })
  const image = new Image()
  image.src = resolveSnapshot({ element, svg })
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = width * 2
  canvas.height = height * 2
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve),
  )
  if (!blob) throw new Error("The active window could not be rasterized.")
  downloadBlob({ filename: `${name}.png`, blob })
}

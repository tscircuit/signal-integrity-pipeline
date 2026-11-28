import {
  type CircuitToWebGpuDrawer,
  getElementId,
  type RenderOptions,
} from "@tscircuit/circuit-json-webgpu"
import type { CircuitJson, LayerRef, PcbRenderLayer } from "circuit-json"
import { CircuitToCanvasDrawer } from "circuit-to-canvas"

/** Keep other enabled layers visible below the active copper layer. */
const OTHER_LAYER_OPACITY = 0.65

/** Supply both engines with the original PCB records, excluding workbench metadata. */
export function boardElements({
  circuit,
  hidden,
}: {
  circuit: CircuitJson
  hidden: ReadonlySet<string>
}): CircuitJson {
  return circuit.filter(
    (record) =>
      record.type.startsWith("pcb_") && !hidden.has(getElementId(record)),
  )
}

/** Set PCB layer visibility independently of the layer drawn uppermost. */
export function gpuLayers({
  layers,
  activeLayer,
}: {
  layers: LayerRef[]
  activeLayer?: LayerRef
}): RenderOptions {
  const visible = ["board", "edge_cuts", ...layers]
  if (layers.length) visible.push("drill")
  for (const layer of layers)
    if (layer === "top" || layer === "bottom")
      visible.push(`${layer}_silkscreen`)
  return {
    layers: visible,
    selectedLayer: activeLayer,
    showBoardMaterial: true,
    hiddenLayerOpacity: OTHER_LAYER_OPACITY,
  }
}

/** Draw the same scene with pcb-viewer's Canvas engine when WebGPU is unavailable. */
export function drawCanvasBoard({
  canvas,
  elements,
  transform,
  layers,
  activeLayer,
}: {
  canvas: HTMLCanvasElement
  elements: CircuitJson
  transform: NonNullable<RenderOptions["transform"]>
  layers: LayerRef[]
  activeLayer?: LayerRef
}): void {
  const context = canvas.getContext("2d")!
  context.clearRect(0, 0, canvas.width, canvas.height)
  const drawer = new CircuitToCanvasDrawer(context)
  drawer.realToCanvasMat = transform
  drawer.drawElements(
    elements.filter(({ type }) => type === "pcb_board" || type === "pcb_panel"),
    { drawBoardMaterial: true },
  )
  const pass = document.createElement("canvas")
  pass.width = canvas.width
  pass.height = canvas.height
  const paint = pass.getContext("2d")!
  const layerDrawer = new CircuitToCanvasDrawer(paint)
  layerDrawer.realToCanvasMat = transform
  const ordered = layers.filter((layer) => layer !== activeLayer).reverse()
  if (activeLayer) ordered.push(activeLayer)
  for (const layer of ordered) {
    paint.clearRect(0, 0, pass.width, pass.height)
    const renderLayers: PcbRenderLayer[] = [`${layer}_copper`]
    if (layer === "top" || layer === "bottom")
      renderLayers.push(`${layer}_silkscreen`)
    layerDrawer.drawElements(elements, {
      layers: renderLayers,
      showPcbNotes: false,
    })
    context.globalAlpha = layer === activeLayer ? 1 : OTHER_LAYER_OPACITY
    context.drawImage(pass, 0, 0)
  }
  context.globalAlpha = 1
}

/** Use the retained GPU renderer and report geometry diagnostics before drawing. */
export function uploadCircuit({
  drawer,
  elements,
}: {
  drawer: CircuitToWebGpuDrawer
  elements: CircuitJson
}): void {
  drawer.setCircuitJson(elements)
  const [diagnostic] = drawer.diagnostics
  if (diagnostic)
    throw new Error(
      `Unsupported WebGPU geometry (${drawer.diagnostics.length}): ${diagnostic.type} · ${diagnostic.message}`,
    )
}

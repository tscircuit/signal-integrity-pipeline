import type { Point } from "circuit-json"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import type { InspectorBoard, InspectorFeature } from "./geometry"
import {
  type BoardAppearance,
  copperHighlight,
  createInspectorSceneContent,
  disposeInspectorScene,
  type InspectorSceneContent,
  pickedFeature,
} from "./scene-geometry"

export const cameraViews = ["Iso", "Top", "Front", "Side"] as const
export type CameraView = (typeof cameraViews)[number]

const cameraDirections = {
  Iso: [1, -1, 1],
  Top: [0, 0, 1],
  Front: [0, -1, 0],
  Side: [1, 0, 0],
} as const

/** Keep the initial board inside the viewport with room around its edges. */
const FRAME_MARGIN = 1.08
/** Distinguish an orbit gesture from a click (CSS pixels). */
const CLICK_SLOP = 4

/** WebGL resources and the orthographic camera shared across board updates. */
interface Viewport {
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  render: () => void
  dispose: () => void
}

/** Set a named camera orientation and reset the zoom to its board framing. */
function aimCamera({
  viewport,
  view,
  board,
}: {
  viewport: Viewport
  view: CameraView
  board: InspectorBoard
}): void {
  const { camera, controls, render } = viewport
  const [x, y, z] = cameraDirections[view]
  camera.position
    .set(x, y, z)
    .normalize()
    .multiplyScalar(camera.far / 2)
  camera.zoom = 1
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
  const aspect = (camera.right - camera.left) / (camera.top - camera.bottom)
  resizeCamera({ camera, board, aspect })
  render()
}

/** Fit the XY diagonal into the shorter dimension of the present viewport. */
function resizeCamera({
  camera,
  board,
  aspect,
}: {
  camera: THREE.OrthographicCamera
  board: InspectorBoard
  aspect: number
}): void {
  const radius = (Math.hypot(board.width, board.height) * FRAME_MARGIN) / 2
  const halfHeight = radius / Math.min(1, aspect)
  camera.left = -halfHeight * aspect
  camera.right = halfHeight * aspect
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.updateProjectionMatrix()
}

/** Create one renderer per mounted board and redraw on camera, resize or scene changes. */
function createViewport({
  host,
  board,
  capture,
}: {
  host: HTMLDivElement
  board: InspectorBoard
  capture: boolean
}): Viewport {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: capture,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const span = Math.max(board.width, board.height, board.thickness * 20)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, span * 8)
  camera.up.set(0, 0, 1)
  const scene = new THREE.Scene()
  const canvas = renderer.domElement
  canvas.setAttribute("aria-label", "Interactive 3D PCB")
  host.append(canvas)
  const controls = new OrbitControls(camera, canvas)
  controls.minZoom = 0.3
  controls.maxZoom = 20
  /** Draw after an explicit scene or camera change. */
  const render = (): void => renderer.render(scene, camera)
  controls.addEventListener("change", render)
  const observer = new ResizeObserver(([{ contentRect }]) => {
    const { width, height } = contentRect
    if (width === 0 || height === 0) return
    resizeCamera({ camera, board, aspect: width / height })
    renderer.setSize(width, height)
    render()
  })
  observer.observe(host)
  return {
    camera,
    scene,
    controls,
    renderer,
    render,
    dispose: () => {
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}

/** Pointer hooks exposed by both board views. */
export interface BoardInteraction {
  hovered: InspectorFeature | undefined
  selected: InspectorFeature | undefined
  onHover: (feature: InspectorFeature | undefined) => void
  onSelect: (feature: InspectorFeature | undefined) => void
  onCursor?: (point: Point) => void
  onContext?: (input: {
    feature: InspectorFeature
    x: number
    y: number
  }) => void
}

/** Raycast against merged copper, only when the user points at the scene. */
function attachPicking({
  viewport,
  content,
  onHover,
  onSelect,
  onCursor,
  onContext,
  board,
}: Pick<BoardInteraction, "onHover" | "onSelect" | "onCursor" | "onContext"> & {
  viewport: Viewport
  content: InspectorSceneContent
  board: InspectorBoard
}): () => void {
  const { renderer, camera } = viewport
  const canvas = renderer.domElement
  const ray = new THREE.Raycaster()
  let origin: THREE.Vector2 | undefined

  /** Pick the visible physical feature beneath the current pointer. */
  const pick = (event: MouseEvent): InspectorFeature | undefined => {
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) * 2) / rect.width - 1
    const y = 1 - ((event.clientY - rect.top) * 2) / rect.height
    ray.setFromCamera(new THREE.Vector2(x, y), camera)
    const hits = ray.intersectObjects<InspectorSceneContent["copper"][number]>(
      content.copper,
      false,
    )
    // Treat rail planes and ghost copper as click-through when opaque copper is under the pointer.
    const hit =
      hits.find(({ object }) => !object.material.transparent) ?? hits[0]
    if (hit) return pickedFeature({ faces: content.faces, hit })
  }
  /** A drag belongs to the orbit controls. */
  const move = (event: PointerEvent): void => {
    if (event.buttons !== 0) return
    onHover(pick(event))
    if (!onCursor) return
    const point = ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1)),
      new THREE.Vector3(),
    )
    if (point)
      onCursor({ x: point.x + board.center.x, y: point.y + board.center.y })
  }
  /** Record the beginning of a possible click. */
  const down = (event: PointerEvent): void => {
    if (event.button !== 0) return
    origin = new THREE.Vector2(event.clientX, event.clientY)
    onHover(undefined)
  }
  /** Commit a selection after a primary click with little movement. */
  const up = (event: PointerEvent): void => {
    const start = origin
    origin = undefined
    if (event.button !== 0 || !start) return
    if (
      Math.hypot(start.x - event.clientX, start.y - event.clientY) < CLICK_SLOP
    ) {
      const feature = pick(event)
      onHover(feature)
      onSelect(feature)
    }
  }
  /** Clear the tooltip when the pointer leaves. */
  const leave = (): void => onHover(undefined)
  /** Select the feature under a context click before opening its actions. */
  const context = (event: MouseEvent): void => {
    if (!onContext) return
    event.preventDefault()
    const feature = pick(event)
    if (feature) onContext({ feature, x: event.clientX, y: event.clientY })
  }
  canvas.addEventListener("contextmenu", context)
  canvas.addEventListener("pointermove", move)
  canvas.addEventListener("pointerdown", down)
  canvas.addEventListener("pointerup", up)
  canvas.addEventListener("pointerleave", leave)
  canvas.addEventListener("pointercancel", leave)
  return () => {
    canvas.removeEventListener("contextmenu", context)
    canvas.removeEventListener("pointermove", move)
    canvas.removeEventListener("pointerdown", down)
    canvas.removeEventListener("pointerup", up)
    canvas.removeEventListener("pointerleave", leave)
    canvas.removeEventListener("pointercancel", leave)
  }
}

/** Mount the orthographic viewer and share copper hover and selection with the 2D view. */
export function Board3d({
  board,
  features,
  view,
  cameraReset,
  exaggeration,
  hovered,
  selected,
  onHover,
  onSelect,
  onCursor,
  onContext,
  appearance,
}: BoardInteraction & {
  board: InspectorBoard
  features: readonly InspectorFeature[]
  view: CameraView
  cameraReset: number
  exaggeration: number
  appearance?: BoardAppearance
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const capture = appearance !== undefined
  const viewport = useRef<Viewport | undefined>(undefined)
  const [error, setError] = useState<string>()
  useEffect(() => {
    try {
      viewport.current = createViewport({ host: host.current!, board, capture })
    } catch (cause) {
      setError((cause as Error).message)
      return
    }
    setError(undefined)
    return () => {
      viewport.current?.dispose()
      viewport.current = undefined
    }
  }, [board, capture])

  useEffect(() => {
    if (viewport.current) aimCamera({ viewport: viewport.current, view, board })
  }, [board, view, cameraReset])

  useEffect(() => {
    const instance = viewport.current
    if (!instance) return
    instance.scene.background = appearance
      ? new THREE.Color(appearance.background)
      : null
    const content = createInspectorSceneContent({
      board,
      features,
      exaggeration,
      appearance,
    })
    instance.scene.add(content.root)
    const detach = attachPicking({
      viewport: instance,
      content,
      onHover,
      onSelect,
      onCursor,
      onContext,
      board,
    })
    instance.render()
    return () => {
      detach()
      disposeInspectorScene(content.root)
    }
  }, [
    board,
    features,
    exaggeration,
    appearance,
    onHover,
    onSelect,
    onCursor,
    onContext,
  ])

  useEffect(() => {
    const instance = viewport.current
    const feature = hovered ?? selected
    if (!instance) return
    if (
      !feature?.shapes.length ||
      !features.some(({ id }) => id === feature.id)
    ) {
      instance.render()
      return
    }
    const highlight = copperHighlight({
      board,
      feature: features.find(({ id }) => id === feature.id)!,
      exaggeration,
      appearance,
    })
    instance.scene.add(highlight)
    instance.render()
    return () => disposeInspectorScene(highlight)
  }, [board, features, hovered, selected, exaggeration, appearance])

  return (
    <div ref={host} className="inspector-canvas">
      {error && <p role="alert">3D view unavailable. {error}</p>}
    </div>
  )
}

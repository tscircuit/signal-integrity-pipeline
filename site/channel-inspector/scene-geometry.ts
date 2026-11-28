import type { Point } from "circuit-json"
import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { type CopperCategory, copperCategories } from "./copper"
import {
  copperStyles,
  type InspectorBoard,
  type InspectorFeature,
  type InspectorShape,
} from "./geometry"

/** A visible trace body is slightly thicker than a physical copper foil. */
const TRACE_HEIGHT_MM = 0.08
/** A small box makes the component footprint outline visible from the side. */
const COMPONENT_HEIGHT_MM = 0.45
/** Enough segments to show round vias at normal board zoom. */
const VIA_SEGMENTS = 12

/** Ordered triangle ranges tie the merged meshes back to individual PCB records. */
interface FeatureFaces {
  feature: InspectorFeature
  end: number
}

type CopperMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>

/** Disposable scene content with one pickable mesh per visible category. */
export interface InspectorSceneContent {
  root: THREE.Group
  copper: CopperMesh[]
  faces: Map<CopperMesh, FeatureFaces[]>
}

/** Colors and dielectric opacity supplied by a host application. */
export interface BoardAppearance {
  background: string
  grid: string
  glass: string
  outline: string
  highlight: string
  copper: Record<CopperCategory, string>
  opacity: number
  farOpacity?: number
}

/** Shared positions for a board's geometry at one explosion setting. */
interface SceneBoard {
  board: InspectorBoard
  exaggeration: number
  appearance?: BoardAppearance
}

/** Convert a Circuit JSON polygon while preserving the cutouts. */
function flatShape({
  rings,
  center,
}: {
  rings: readonly (readonly Point[])[]
  center: Point
}): THREE.Shape {
  const [outer, ...holes] = rings.map((ring) =>
    ring.map(({ x, y }) => new THREE.Vector2(x - center.x, y - center.y)),
  )
  const shape = new THREE.Shape(outer)
  shape.holes = holes.map((hole) => new THREE.Path(hole))
  return shape
}

/** Generate one copper primitive in the common board coordinate system. */
function copperGeometry({
  shape,
  board,
  exaggeration,
}: SceneBoard & { shape: InspectorShape }): THREE.BufferGeometry {
  const { center } = board
  const z = board.layerZ.get(shape.layers[0])! * exaggeration
  if (shape.shape === "wire") {
    const { start, end } = shape
    const dx = end.x - start.x
    const dy = end.y - start.y
    return new THREE.BoxGeometry(
      Math.hypot(dx, dy),
      shape.width,
      TRACE_HEIGHT_MM,
    )
      .rotateZ(Math.atan2(dy, dx))
      .translate(
        (start.x + end.x) / 2 - center.x,
        (start.y + end.y) / 2 - center.y,
        z,
      )
  }
  if (shape.shape === "via") {
    const otherZ = board.layerZ.get(shape.layers.at(-1)!)! * exaggeration
    const radius = shape.diameter / 2
    return new THREE.CylinderGeometry(
      radius,
      radius,
      Math.abs(otherZ - z) + TRACE_HEIGHT_MM,
      VIA_SEGMENTS,
    )
      .rotateX(Math.PI / 2)
      .translate(
        shape.center.x - center.x,
        shape.center.y - center.y,
        (z + otherZ) / 2,
      )
  }
  return new THREE.ShapeGeometry(
    flatShape({ rings: shape.rings, center }),
  ).translate(0, 0, z)
}

/** Group geometry by category and record face spans for pointer picking. */
function addCopper({
  root,
  copper,
  faces,
  features,
  board,
  exaggeration,
  appearance,
}: InspectorSceneContent &
  SceneBoard & { features: readonly InspectorFeature[] }): void {
  for (const category of copperCategories) {
    const geometries: THREE.BufferGeometry[] = []
    const ranges: FeatureFaces[] = []
    let end = 0
    for (const feature of features) {
      if (feature.category !== category) continue
      const begin = end
      for (const shape of feature.shapes) {
        const geometry = copperGeometry({ shape, board, exaggeration })
        let triangles = geometry
        if (geometry.index) {
          triangles = geometry.toNonIndexed()
          geometry.dispose()
        }
        const positions = triangles.getAttribute("position")
        const positionsOnly = new THREE.BufferGeometry().setAttribute(
          "position",
          positions,
        )
        triangles.dispose()
        geometries.push(positionsOnly)
        end += positions.count / 3
      }
      if (end > begin) ranges.push({ feature, end })
    }
    if (geometries.length === 0) continue
    const style = copperStyles[category]
    const opacity =
      category === "far"
        ? (appearance?.farOpacity ?? style.opacity)
        : style.opacity
    const material = new THREE.MeshBasicMaterial({
      color: appearance?.copper[category] ?? style.color,
      opacity,
      transparent: opacity < 1,
      depthWrite: opacity === 1,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    })
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material)
    for (const geometry of geometries) geometry.dispose()
    mesh.renderOrder = style.order
    root.add(mesh)
    copper.push(mesh)
    faces.set(mesh, ranges)
  }
}

/** Draw separated dielectric slabs and component boxes with their physical footprints. */
function addBoard({
  root,
  board,
  exaggeration,
  appearance,
}: SceneBoard & { root: THREE.Group }): void {
  const shape = flatShape({ rings: [board.outline], center: board.center })
  const glass = new THREE.MeshBasicMaterial({
    color: appearance?.glass ?? "#87b9dc",
    transparent: true,
    opacity: appearance?.opacity ?? 0.045,
    depthWrite: false,
  })
  const outline = new THREE.LineBasicMaterial({
    color: appearance?.outline ?? "#7897b5",
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  })
  for (const { zMinMm, zMaxMm } of board.dielectrics) {
    const depth = zMaxMm - zMinMm
    const z = ((zMinMm + zMaxMm) * exaggeration - depth) / 2
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
    }).translate(0, 0, z)
    const slab = new THREE.Mesh(geometry, glass)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      outline,
    )
    root.add(slab, edges)
  }

  for (const component of board.components) {
    const z = board.layerZ.get(component.layer)! * exaggeration
    const direction = component.layer === "bottom" ? -1 : 1
    const box = new THREE.BoxGeometry(
      component.width,
      component.height,
      COMPONENT_HEIGHT_MM,
    )
    const edges = new THREE.EdgesGeometry(box)
    box.dispose()
    edges.translate(
      component.center.x - board.center.x,
      component.center.y - board.center.y,
      z + (direction * COMPONENT_HEIGHT_MM) / 2,
    )
    root.add(new THREE.LineSegments(edges, outline))
  }
}

/** Build a fresh set of merged meshes without changing the camera or orbit. */
export function createInspectorSceneContent({
  board,
  features,
  exaggeration,
  appearance,
}: SceneBoard & {
  features: readonly InspectorFeature[]
}): InspectorSceneContent {
  const content: InspectorSceneContent = {
    root: new THREE.Group(),
    copper: [],
    faces: new Map(),
  }
  if (appearance) {
    const grid = new THREE.GridHelper(
      Math.max(board.width, board.height) * 2,
      20,
      appearance.grid,
      appearance.grid,
    )
    grid.rotateX(Math.PI / 2)
    grid.position.z = (-board.thickness * exaggeration) / 2 - 0.4
    content.root.add(grid)
  }
  addBoard({ root: content.root, board, exaggeration, appearance })
  addCopper({ ...content, features, board, exaggeration, appearance })
  return content
}

/** Resolve a triangle in a merged mesh to the copper feature that owns it. */
export function pickedFeature({
  faces,
  hit,
}: {
  faces: InspectorSceneContent["faces"]
  hit: THREE.Intersection<CopperMesh>
}): InspectorFeature | undefined {
  const face = hit.faceIndex
  if (face == null) return
  return faces.get(hit.object)?.find((range) => face < range.end)?.feature
}

/** Highlight every shape belonging to a record, even when its category is translucent. */
export function copperHighlight({
  feature,
  board,
  exaggeration,
  appearance,
}: SceneBoard & { feature: InspectorFeature }): THREE.LineSegments {
  const geometries = feature.shapes.map((shape) => {
    const solid = copperGeometry({ shape, board, exaggeration })
    const edges = new THREE.EdgesGeometry(solid)
    solid.dispose()
    return edges
  })
  const geometry = mergeGeometries(geometries)
  for (const edges of geometries) edges.dispose()
  const material = new THREE.LineBasicMaterial({
    color: appearance?.highlight ?? "#e9fcff",
    depthTest: false,
    depthWrite: false,
  })
  const highlight = new THREE.LineSegments(geometry, material)
  highlight.renderOrder = 5
  return highlight
}

/** Release GPU resources when replacing a group or removing the inspector. */
export function disposeInspectorScene(root: THREE.Object3D): void {
  root.removeFromParent()
  const materials = new Set<THREE.Material>()
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.LineSegments))
      return
    node.geometry.dispose()
    materials.add(node.material)
  })
  for (const material of materials) material.dispose()
}

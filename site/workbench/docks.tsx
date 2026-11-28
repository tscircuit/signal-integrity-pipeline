import { type JSX, type ReactNode, useRef, useState } from "react"
import type { InspectorFeature } from "../channel-inspector/geometry"
import { CaptionIcon } from "./icons"
import type { NetRole } from "./model/net-roles"
import type { ProjectNode, PropertyGroup } from "./project"

/** A dock and its horizontal sizing handle. */
export function Dock({
  side,
  title,
  shown,
  close,
  children,
  layoutKey,
}: {
  side: "left" | "right"
  title: string
  shown: boolean
  close: () => void
  children: ReactNode
  layoutKey: number
}): JSX.Element | null {
  const [size, setSize] = useState({
    layoutKey,
    width: side === "left" ? 230 : 250,
  })
  const width =
    size.layoutKey === layoutKey ? size.width : side === "left" ? 230 : 250
  const drag = useRef<{ origin: number; width: number }>(undefined)
  if (!shown) return null
  return (
    <div className="wb-dock-wrap" data-side={side} style={{ width }}>
      <aside className="wb-dock">
        <h2>
          {title}
          <button
            title={`Close ${title}`}
            aria-label={`Close ${title}`}
            onClick={close}
          >
            <CaptionIcon name="close" />
          </button>
        </h2>
        {children}
      </aside>
      <div
        className="wb-splitter"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            origin: event.clientX,
            width: event.currentTarget.parentElement!.clientWidth,
          }
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1 || !drag.current) return
          const delta = event.clientX - drag.current.origin
          setSize({
            layoutKey,
            width: Math.min(
              420,
              Math.max(
                side === "left" ? 160 : 190,
                drag.current.width + delta * (side === "left" ? 1 : -1),
              ),
            ),
          })
        }}
        onPointerUp={() => {
          drag.current = undefined
        }}
        onPointerCancel={() => {
          drag.current = undefined
        }}
      />
    </div>
  )
}

const propertyHelp: Record<string, string> = {
  ID: "Unique identifier of this record in the design.",
  Type: "The physical or logical record type for this object.",
  Category: "How this copper is used by the selected simulation.",
  Scope: "Why the copper is retained, classified as far, or excluded.",
  Layers: "Copper layers occupied by this route or feature.",
  "Width / diameter": "Trace widths and via diameters present in this feature.",
  Width: "Overall board size in the X direction.",
  Height: "Overall board size in the Y direction.",
  Length: "Sum of the routed planar segments in this copper feature.",
  Role: "Choose whether this net is a victim, an aggressor, or excluded.",
  Driver: "Component and pin that launch the channel stimulus.",
  Receivers: "Components and pins where the channel is observed.",
  Pattern: "Bit pattern used to drive the selected channel or aggressors.",
  "Bit rate":
    "Number of bits sent per second, displayed in megabits per second.",
  Duration: "Length of the transient capture in nanoseconds.",
  "Scope radius":
    "Maximum distance from victim copper to consider nearby conductors.",
  Disabled: "Whether aggressor outputs are put into their disabled state.",
  Component: "Reference designator of the owning component.",
  Pin: "Physical pin number on the component.",
  Port: "Logical name of the pin in the PCB design.",
  Net: "Electrical network connected to this pin.",
  "IBIS component": "Component declaration in the embedded IBIS document.",
  "Assigned model": "IBIS buffer used by the solver for this physical pin.",
  Corner: "Process corner used by the assigned buffer.",
  Asset: "Original path of the embedded IBIS asset.",
  Thickness: "Physical height of the board or layer in millimeters.",
  Layer: "Physical stack layer or dielectric material name.",
  "Copper layers": "Count of copper layers in the board stackup.",
  Dk: "Relative permittivity of the dielectric.",
  Df: "Dielectric loss tangent.",
  Conductivity: "Electrical conductivity in siemens per meter.",
  Experiment: "The name of the transient experiment used for this capture.",
  Samples: "Number of native solver time points in this capture.",
  Probes: "Number of voltage vectors sampled across the board.",
  Qualification: "Qualification label reported by the simulation pipeline.",
}

/** Display stable property categories for a hovered or selected object. */
export function Properties({
  node,
  feature,
  editRole,
  role,
  editModel,
}: {
  node?: ProjectNode
  feature?: InspectorFeature
  editRole?: (role: NetRole) => void
  role?: NetRole
  editModel?: () => void
}): JSX.Element | null {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [property, setProperty] = useState<string>()
  if (!node && !feature) return null
  const geometry: PropertyGroup[] = []
  if (feature) {
    const widths = [
      ...new Set(
        feature.shapes.flatMap((shape) => {
          if (shape.shape === "wire") return [shape.width]
          if (shape.shape === "via") return [shape.diameter]
          return []
        }),
      ),
    ]
    const length = feature.shapes.reduce((total, shape) => {
      if (shape.shape !== "wire") return total
      return (
        total +
        Math.hypot(shape.start.x - shape.end.x, shape.start.y - shape.end.y)
      )
    }, 0)
    geometry.push(
      {
        name: "Copper identity",
        fields: [
          ["ID", feature.id],
          ["Type", feature.record.type],
          ["Category", feature.category],
          ["Scope", feature.reason],
        ],
      },
      {
        name: "Route geometry",
        fields: [
          ["Layers", feature.layers.join(", ")],
          ["Width / diameter", widths.length ? `${widths.join(", ")} mm` : "—"],
          ["Length", length ? `${length.toFixed(2)} mm` : "—"],
        ],
      },
    )
  }
  if (feature && editRole)
    geometry.push({
      name: "Simulation role",
      fields: [
        [
          "Role",
          <select
            key="role"
            aria-label="Copper role"
            value={role ?? ""}
            onChange={(event) => editRole(event.target.value as NetRole)}
          >
            <option value="" disabled>
              Automatic
            </option>
            <option value="selected">Victim</option>
            <option value="near">Aggressor</option>
            <option value="excluded">Exclude</option>
          </select>,
        ],
      ],
    })
  const groups = [...(node?.groups ?? []), ...geometry]
  return (
    <div className="wb-properties">
      <strong className="wb-property-caption">
        {node?.label ?? feature?.id}
      </strong>
      <div className="wb-property-scroll">
        <table className="wb-grid">
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          {groups.map(({ name, fields }) => (
            <tbody key={name}>
              <tr className="wb-property-group">
                <th colSpan={2}>
                  <button
                    aria-expanded={!collapsed.includes(name)}
                    onClick={() =>
                      setCollapsed((items) =>
                        items.includes(name)
                          ? items.filter((item) => item !== name)
                          : [...items, name],
                      )
                    }
                  >
                    <span className="wb-tree-expander" aria-hidden="true">
                      {collapsed.includes(name) ? "+" : "−"}
                    </span>
                    {name}
                  </button>
                </th>
              </tr>
              {!collapsed.includes(name) &&
                fields.map(([label, value]) => (
                  <tr
                    key={label}
                    aria-selected={property === label}
                    onClick={() => setProperty(label)}
                  >
                    <td>{label}</td>
                    <td>
                      {value}
                      {label === "Assigned model" && editModel && (
                        <button onClick={editModel}>Edit…</button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="wb-property-help">
        <strong>{property ?? "Description"}</strong>
        <br />
        {(property && propertyHelp[property]) ??
          feature?.reason ??
          node?.description ??
          "Select another project item to inspect its properties."}
      </div>
    </div>
  )
}

import type { JSX, MouseEvent, ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import type { SourcePortId } from "../../src/board"
import type { InspectorFeature } from "../channel-inspector/geometry"
import { Icon, type IconName } from "./icons"

type Field = [label: string, value: ReactNode]
export interface PropertyGroup {
  name: string
  fields: Field[]
}
export interface ProjectNode {
  id: string
  label: string
  icon: IconName
  copper?: InspectorFeature
  port?: SourcePortId
  modelId?: string
  run?: number
  simulation?: number
  window?: "board" | "stackup" | "scope"
  groups?: PropertyGroup[]
  description?: string
  collapsed?: boolean
  current?: boolean
  swatch?: boolean
  buffer?: string
  children?: ProjectNode[]
}

export interface ResultNode {
  id: number
  label: string
  fields: Field[]
}

/** Find the selected tree object after the design is edited or the board is picked. */
export function findProjectNode({
  root,
  id,
  copper,
}: {
  root?: ProjectNode
  id?: string
  copper?: string
}): ProjectNode | undefined {
  if (!root) return
  if (root.id === id || (copper && root.copper?.id === copper)) return root
  for (const child of root.children ?? []) {
    const match = findProjectNode({ root: child, id, copper })
    if (match) return match
  }
}

interface TreeActions {
  selected?: string
  pick: (node: ProjectNode) => void
  open: (node: ProjectNode) => void
  context: (input: { node: ProjectNode; event: MouseEvent }) => void
}

/** Render one branch and expand the path to selection originating from the board. */
function TreeBranch({
  node,
  actions,
}: {
  node: ProjectNode
  actions: TreeActions
}): JSX.Element {
  const [expanded, expand] = useState(!node.collapsed)
  const row = useRef<HTMLButtonElement>(null)
  const selected = node.id === actions.selected
  const expandable = (node.children?.length ?? 0) > 0
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" })
    if (findProjectNode({ root: node, id: actions.selected }) && !selected)
      expand(true)
  }, [actions.selected, selected])
  return (
    <li
      role="treeitem"
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
    >
      <div className="wb-tree-row">
        {expandable ? (
          <button
            className="wb-tree-expander"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
            onClick={() => expand(!expanded)}
          >
            {expanded ? "−" : "+"}
          </button>
        ) : (
          <i className="wb-tree-indent" />
        )}
        <button
          ref={row}
          className="wb-tree-node"
          onClick={() => actions.pick(node)}
          onDoubleClick={() => actions.open(node)}
          onContextMenu={(event) => actions.context({ node, event })}
          title={node.label}
          data-current={node.current}
        >
          {node.swatch && node.copper && (
            <i
              className="wb-swatch"
              style={{ background: `var(--${node.copper.category})` }}
            />
          )}
          {(!node.swatch || !node.copper) && <Icon name={node.icon} />}
          <span>{node.label}</span>
        </button>
      </div>
      {expandable && expanded && (
        <ul role="group">
          {node.children!.map((item) => (
            <TreeBranch key={item.id} node={item} actions={actions} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Present the document hierarchy in a docked desktop tree. */
export function ProjectTree({
  root,
  ...actions
}: { root?: ProjectNode } & TreeActions): JSX.Element {
  if (!root) return <div className="wb-tree wb-muted">No design open</div>
  return (
    <ul className="wb-tree" role="tree" aria-label="Project Explorer">
      <TreeBranch node={root} actions={actions} />
    </ul>
  )
}

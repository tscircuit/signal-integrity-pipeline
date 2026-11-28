import { useState } from "react"
import type { CircuitJson } from "../../src/board"
import type { InspectorInput } from "../channel-inspector/input"
import { updateDesign } from "./model/design"

interface History {
  versions: InspectorInput[]
  index: number
}

/** The loaded version, current revision, and immutable history actions. */
export interface DesignHistory {
  original?: InspectorInput
  input?: InspectorInput
  dirty: boolean
  open: (input?: InspectorInput) => void
  edit: (circuit: CircuitJson) => void
  undo?: () => void
  redo?: () => void
  reset?: () => void
}

/** Retain immutable design revisions independently from view controls. */
export function useDesignHistory(): DesignHistory {
  const [history, setHistory] = useState<History>({ versions: [], index: 0 })
  const input = history.versions[history.index]
  return {
    input,
    original: history.versions[0],
    dirty: history.index > 0,
    open: (next) => setHistory({ versions: next ? [next] : [], index: 0 }),
    edit: (circuit) => {
      if (!input || input.circuit === circuit) return
      const next = updateDesign({ input, circuit })
      setHistory({
        versions: [...history.versions.slice(0, history.index + 1), next],
        index: history.index + 1,
      })
    },
    undo:
      history.index > 0
        ? () =>
            setHistory((previous) => ({
              ...previous,
              index: previous.index - 1,
            }))
        : undefined,
    redo:
      history.index < history.versions.length - 1
        ? () =>
            setHistory((previous) => ({
              ...previous,
              index: previous.index + 1,
            }))
        : undefined,
    reset:
      history.index > 0
        ? () => setHistory((previous) => ({ ...previous, index: 0 }))
        : undefined,
  }
}

import type { Point } from "circuit-json"
import { useCallback, useMemo, useState } from "react"
import type { BoardInteraction } from "../channel-inspector/board-3d"
import {
  type CopperCategory,
  categorizeCopper,
} from "../channel-inspector/copper"
import {
  type InspectorFeature,
  inspectorFeatures,
} from "../channel-inspector/geometry"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"

import { type NetRole, netRoles } from "./model/net-roles"
import { stimulusRadius } from "./model/stimulus"

export interface CopperContext {
  feature: InspectorFeature
  x: number
  y: number
}

/** Current physical selection and linked board interaction handlers. */
export interface BoardSelection {
  features: InspectorFeature[]
  retained: ReadonlySet<string>
  error?: string
  selected?: InspectorFeature
  hovered?: InspectorFeature
  context?: CopperContext
  cursor?: Point
  interaction: BoardInteraction
  select: (id?: string) => void
  closeContext: () => void
  reset: () => void
}

const roles: Record<NetRole, { category: CopperCategory; reason: string }> = {
  selected: { category: "selected", reason: "Assigned as victim." },
  near: { category: "near", reason: "Assigned as aggressor." },
  excluded: { category: "far", reason: "Excluded from channel selection." },
}

/** Compute observable copper and synchronize board picking with project selection. */
export function useBoardSelection({
  input,
  simulation,
  onPick,
}: {
  input?: InspectorInput
  simulation?: ChannelSimulation
  onPick: (id?: string) => void
}): BoardSelection {
  const [hoverId, setHover] = useState<string>()
  const [selectedId, setSelected] = useState<string>()
  const [cursor, setCursor] = useState<Point>()
  const [context, setContext] = useState<CopperContext>()
  const overrides = useMemo(() => netRoles(simulation), [simulation])
  const scope = useMemo(() => {
    if (!input || !simulation) return { features: [] }
    try {
      const copper = categorizeCopper({
        circuit: input.circuit,
        simulation,
        distanceMm: stimulusRadius({ simulation, defaultMm: input.distanceMm }),
      })
      return {
        features: inspectorFeatures({ ...copper, board: input.board }),
        retained: copper.retainedSourceIds,
      }
    } catch (cause) {
      return { features: [], error: (cause as Error).message }
    }
  }, [input, simulation])
  const features = useMemo(
    () =>
      scope.features.map((feature) => {
        const override = overrides[feature.id]
        if (override) return { ...feature, ...roles[override] }
        return feature
      }),
    [scope, overrides],
  )
  const selected = features.find(({ id }) => id === selectedId)
  const hovered = features.find(({ id }) => id === hoverId)
  const interaction: BoardInteraction = {
    selected,
    hovered,
    onCursor: setCursor,
    onHover: useCallback((feature) => setHover(feature?.id), []),
    onSelect: useCallback(
      (feature) => {
        setSelected(feature?.id)
        onPick(feature?.id)
      },
      [onPick],
    ),
    onContext: useCallback(
      (next: CopperContext) => {
        setSelected(next.feature.id)
        onPick(next.feature.id)
        setContext(next)
      },
      [onPick],
    ),
  }
  return {
    features,
    retained: scope.retained ?? new Set(),
    error: scope.error,
    selected,
    hovered,
    cursor,
    context,
    interaction,
    select: setSelected,
    closeContext: () => setContext(undefined),
    reset: () => {
      setHover(undefined)
      setSelected(undefined)
      setCursor(undefined)
      setContext(undefined)
    },
  }
}

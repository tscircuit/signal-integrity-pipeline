import { type JSX, useEffect } from "react"
import type { CopperContext } from "./board-selection"
import { type Command, CommandButton } from "./chrome"
import type { NetRole } from "./model/net-roles"

const actions: { role: NetRole; label: string }[] = [
  { role: "selected", label: "Make victim" },
  { role: "near", label: "Make aggressor" },
  { role: "excluded", label: "Exclude" },
]

/** Open a themed context menu beside the picked board or tree object. */
export function CopperMenu({
  context,
  editable,
  current,
  extra,
  edit,
  close,
}: {
  context: CopperContext
  editable: boolean
  current?: NetRole
  extra: Command[]
  edit: (role: NetRole) => void
  close: () => void
}): JSX.Element {
  return (
    <div
      role="menu"
      className="wb-popover wb-context"
      style={{
        left: Math.max(0, Math.min(context.x, window.innerWidth - 194)),
        top: Math.max(0, Math.min(context.y, window.innerHeight - 190)),
      }}
    >
      {actions.map(({ role, label }) => (
        <CommandButton
          key={role}
          command={{
            label,
            checked: current === role,
            action: editable && current !== role ? () => edit(role) : undefined,
          }}
          onInvoke={close}
        />
      ))}
      <div role="separator" className="wb-menu-separator" />
      {extra.map((command) => (
        <CommandButton key={command.label} command={command} onInvoke={close} />
      ))}
    </div>
  )
}

/** Dismiss the active context menu when the user clicks elsewhere or presses Escape. */
export function useCopperContextDismiss({
  context,
  closeContext,
}: {
  context?: CopperContext
  closeContext: () => void
}): void {
  useEffect(() => {
    if (!context) return
    const listener = new AbortController()
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!(event.target as HTMLElement).closest(".wb-context"))
          closeContext()
      },
      { signal: listener.signal },
    )
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") closeContext()
      },
      { signal: listener.signal },
    )
    return () => listener.abort()
  }, [context])
}

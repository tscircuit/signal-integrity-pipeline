import {
  type JSX,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

import { CaptionIcon, Icon, type IconName } from "./icons"

export { Icon, type IconName } from "./icons"

export const themes = {
  classic: "Windows Classic",
  luna: "XP Luna",
  dark: "Dark",
} as const
export type Theme = keyof typeof themes
export const themeIds = ["classic", "luna", "dark"] as const

export interface Command {
  label: string
  action?: () => void
  shortcut?: string
  title?: string
  checked?: boolean
  radio?: boolean
  separator?: boolean
  items?: Command[]
}

export interface Menu {
  label: string
  mnemonic?: number
  items: Command[]
}

/** Match a visible shortcut against the current keypress. */
function matches({
  shortcut,
  event,
}: {
  shortcut: string
  event: KeyboardEvent
}): boolean {
  const key = shortcut.split("+").at(-1)
  return (
    key?.toLowerCase() === event.key.toLowerCase() &&
    shortcut.startsWith("Ctrl+") === (event.ctrlKey || event.metaKey) &&
    shortcut.includes("Alt+") === event.altKey &&
    shortcut.includes("Shift+") === event.shiftKey
  )
}

/** Recursively include nested accelerators in the same dispatch as top-level commands. */
function menuCommands(items: Command[]): Command[] {
  return items.flatMap((item) => [item, ...menuCommands(item.items ?? [])])
}

/** Activate a menu by mnemonic or dispatch its enabled keyboard command. */
function dispatchMenuKey({
  event,
  menus,
  open,
  bar,
  setOpen,
}: {
  event: KeyboardEvent
  menus: Menu[]
  open?: string
  bar: HTMLElement | null
  setOpen: (value?: string) => void
}): void {
  if (document.querySelector("dialog[open]")) return
  if (event.key === "Escape" && open) {
    setOpen(undefined)
    return
  }
  if (
    (event.target as HTMLElement).closest(
      "input:not([type=checkbox], [type=radio], [type=button]), textarea, select, [contenteditable=true]",
    )
  )
    return
  const menu = menus.find(
    ({ label, mnemonic = 0 }) =>
      event.altKey && event.key.toLowerCase() === label[mnemonic].toLowerCase(),
  )
  if (menu) {
    event.preventDefault()
    setOpen(menu.label)
    requestAnimationFrame(() =>
      bar?.querySelector<HTMLButtonElement>("[role=menuitem]:enabled")?.focus(),
    )
    return
  }
  const command = menus
    .flatMap(({ items }) => menuCommands(items))
    .find(
      ({ shortcut, action }) =>
        action && shortcut && matches({ shortcut, event }),
    )
  if (!command?.action) return
  event.preventDefault()
  command.action()
  setOpen(undefined)
}

/** A mouse and keyboard operable desktop menu bar. */
export function MenuBar({ menus }: { menus: Menu[] }): JSX.Element {
  const [open, setOpen] = useState<string>()
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    const listeners = new AbortController()
    const { signal } = listeners
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!bar.current?.contains(event.target as Node)) setOpen(undefined)
      },
      { signal },
    )
    document.addEventListener(
      "keydown",
      (event) =>
        dispatchMenuKey({ event, menus, open, bar: bar.current, setOpen }),
      { signal },
    )
    return () => listeners.abort()
  }, [menus, open])
  return (
    <nav className="wb-menu-bar" ref={bar} aria-label="Main menu">
      {menus.map(({ label, items, mnemonic = 0 }) => (
        <div className="wb-menu" key={label}>
          <button
            aria-expanded={open === label}
            aria-haspopup="menu"
            onPointerEnter={() => {
              if (open) setOpen(label)
            }}
            onClick={() => setOpen(open === label ? undefined : label)}
          >
            {label.slice(0, mnemonic)}
            <u>{label[mnemonic]}</u>
            {label.slice(mnemonic + 1)}
          </button>
          {open === label && (
            <div
              className="wb-popover"
              role="menu"
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
                event.preventDefault()
                const entries = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:enabled",
                  ),
                ]
                const delta = event.key === "ArrowDown" ? 1 : -1
                entries[
                  (entries.indexOf(
                    document.activeElement as HTMLButtonElement,
                  ) +
                    delta +
                    entries.length) %
                    entries.length
                ]?.focus()
              }}
            >
              {items.map((item) => (
                <CommandEntry
                  key={item.label}
                  command={item}
                  onInvoke={() => setOpen(undefined)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}

/** Render a separator, command, or keyboard-accessible submenu. */
function CommandEntry({
  command,
  onInvoke,
}: {
  command: Command
  onInvoke: () => void
}): JSX.Element {
  const [expanded, expand] = useState(false)
  if (command.separator)
    return <div className="wb-menu-separator" role="separator" />
  if (!command.items)
    return <CommandButton command={command} onInvoke={onInvoke} />
  return (
    <div
      className="wb-submenu"
      onPointerEnter={() => expand(true)}
      onPointerLeave={() => expand(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) expand(false)
      }}
    >
      <button
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={expanded}
        onClick={() => expand(!expanded)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return
          expand(true)
          const entry = event.currentTarget.parentElement
          requestAnimationFrame(() =>
            entry
              ?.querySelector<HTMLButtonElement>(".wb-popover button:enabled")
              ?.focus(),
          )
        }}
      >
        <span />
        <span>{command.label}</span>
        <kbd aria-hidden="true">▸</kbd>
      </button>
      {expanded && (
        <div className="wb-popover" role="menu">
          {command.items.map((item) => (
            <CommandEntry key={item.label} command={item} onInvoke={onInvoke} />
          ))}
        </div>
      )}
    </div>
  )
}

/** One command in a menu or context menu. */
export function CommandButton({
  command,
  onInvoke,
}: {
  command: Command
  onInvoke: () => void
}): JSX.Element {
  return (
    <button
      role="menuitem"
      disabled={!command.action}
      title={command.title ?? command.label}
      onClick={() => {
        command.action?.()
        onInvoke()
      }}
    >
      <span className="wb-command-check" aria-hidden="true">
        {command.checked && (command.radio ? "●" : "✓")}
      </span>
      <span>{command.label}</span>
      <kbd aria-hidden="true">{command.shortcut}</kbd>
    </button>
  )
}

/** Open a native modal with themed desktop chrome and standard dialog actions. */
export function Modal({
  title,
  close,
  apply,
  confirm,
  icon = "app",
  closeLabel = "OK",
  children,
}: {
  title: string
  close: () => void
  apply?: () => boolean
  confirm?: () => void
  icon?: IconName
  closeLabel?: string
  children: ReactNode
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog
      className="wb-modal"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="wb-child-title">
        <span className="wb-caption">
          <Icon name={icon} />
          <strong id={titleId}>{title}</strong>
        </span>
        <div className="wb-title-buttons">
          <button aria-label="Close dialog" onClick={close}>
            <CaptionIcon name="close" />
          </button>
        </div>
      </div>
      <div className="wb-dialog-body">{children}</div>
      <div className="wb-dialog-actions">
        <button
          onClick={() => {
            if (confirm) confirm()
            if (!apply || apply()) close()
          }}
        >
          {closeLabel}
        </button>
        {(apply || confirm) && <button onClick={close}>Cancel</button>}
        {apply && <button onClick={apply}>Apply</button>}
      </div>
    </dialog>
  )
}

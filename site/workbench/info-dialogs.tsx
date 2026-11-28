import { type JSX, useState } from "react"
import { Icon, Modal } from "./chrome"
import { downloadBlob } from "./exports"

/** Show the installed solver and workbench components. */
export function AboutDialog({
  version,
  close,
}: {
  version?: string
  close: () => void
}): JSX.Element {
  return (
    <Modal title="About SI Workbench" close={close}>
      <div className="wb-about">
        <Icon name="app" />
        <div>
          <h2>tscircuit SI Workbench</h2>
          <p>@tscircuit/core · RoutedPipelineSolver</p>
          <hr />
          <p>{version ?? "Local ngspice status unavailable"}</p>
        </div>
      </div>
    </Modal>
  )
}

/** Inspect and copy the exact deck built for the most recent completed capture. */
export function DeckDialog({
  deck,
  close,
}: {
  deck: string
  close: () => void
}): JSX.Element {
  const [message, setMessage] = useState("")
  return (
    <Modal
      title="Compiled SPICE Deck"
      close={close}
      closeLabel="Close"
      icon="log"
    >
      <textarea
        className="wb-deck"
        aria-label="Compiled SPICE deck"
        readOnly
        value={deck}
      />
      <div className="wb-tool-row">
        <span>{deck.split("\n").length} lines</span>
        <button
          onClick={() =>
            void navigator.clipboard.writeText(deck).then(
              () => setMessage("Deck copied"),
              (cause: Error) => setMessage(cause.message),
            )
          }
        >
          Copy to Clipboard
        </button>
        <button
          onClick={() =>
            downloadBlob({
              filename: "workbench.cir",
              blob: new Blob([deck], { type: "text/plain" }),
            })
          }
        >
          Download .cir
        </button>
        <output>{message}</output>
      </div>
    </Modal>
  )
}

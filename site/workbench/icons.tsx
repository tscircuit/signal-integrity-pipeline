import type { JSX } from "react"

const icons = {
  app: ["#276bb9", "M1 2h14v12H1z", "M3 10h2V5h4v5h4V4"],
  open: ["#f2c94c", "M1 4h6l2 2h6l-2 7H1z", "M2 8h11"],
  sample: ["#4fb978", "M1 3h14v11H1z", "M4 6h3v4h5M11 6h2M4 12h2"],
  board: ["#57a774", "M1 6l7-4 7 4v4l-7 4-7-4z", "M1 6l7 4 7-4M8 10v4"],
  stackup: ["#d39d53", "M1 5l7-4 7 4v6l-7 4-7-4z", "M1 5l7 4 7-4M1 8l7 4 7-4"],
  models: [
    "#b8bde1",
    "M4 4h8v8H4z",
    "M6 1v3m4-3v3M6 12v3m4-3v3M1 6h3m-3 4h3m8-4h3m-3 4h3",
  ],
  ibisCurve: ["#b7dfff", "M1 2h14v12H1z", "M3 11h3l4-6h3M3 4v8h10"],
  info: ["#91c8ff", "M8 1a7 7 0 1 0 0 14 7 7 0 1 0 0-14z", "M8 7v5m0-8v1"],
  ok: ["#79d276", "M8 1a7 7 0 1 0 0 14 7 7 0 1 0 0-14z", "m4 8 3 3 5-6"],
  warning: ["#ffcc48", "M8 1 15 14H1z", "M8 5v4m0 2v1"],
  error: ["#ff8175", "M8 1a7 7 0 1 0 0 14 7 7 0 1 0 0-14z", "m5 5 6 6m0-6-6 6"],
  stimulus: ["#c78bba", "M1 2h14v12H1z", "M2 10h3V5h4v5h3V5h2"],
  run: ["#35b958", "M4 2l10 6-10 6z", ""],
  stop: ["#e36658", "M3 3h10v10H3z", ""],
  scope: ["#6ecfac", "M1 2h14v12H1z", "M3 10l2-3 2 3 2-5 3 2h1"],
  log: ["#eee9d2", "M3 1h7l3 3v11H3z", "M5 6h6m-6 3h6m-6 3h4"],
  save: ["#6e9cdb", "M2 1h10l2 2v12H2z", "M5 2v4h6V2M5 14v-5h6v5"],
  folder: ["#eeb849", "M1 4h6l2 2h6v7H1z", "M2 7h12"],
  pin: ["#e6ab64", "M6 1h4v8l-2 6-2-6z", "M7 4h2"],
} as const
export type IconName = keyof typeof icons

/** Draw a crisp, original 16-pixel engineering toolbar or tree icon. */
export function Icon({ name }: { name: IconName }): JSX.Element {
  const [color, silhouette, detail] = icons[name]
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      strokeLinejoin="round"
    >
      <path d={silhouette} fill={color} stroke="#20242a" />
      <path d={detail} fill="none" stroke="#20242a" />
    </svg>
  )
}

const captionPaths = {
  minimize: "M1 6.5h7",
  maximize: "M1.5 1.5h6v6h-6z M2 2.5h5",
  restore: "M3.5 3V1.5h4v4H6 M1.5 3.5h4v4h-4z",
  close: "m2 2 5 5m0-5L2 7",
} as const

/** Draw a centered nine-pixel desktop caption control. */
export function CaptionIcon({
  name,
}: {
  name: keyof typeof captionPaths
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 9 9"
      width="9"
      height="9"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d={captionPaths[name]} />
    </svg>
  )
}

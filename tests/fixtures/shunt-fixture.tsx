import { Fragment, type JSX } from "react"

/** Place two shunts across the driver and receiver sides of one channel leg. */
export function ShuntFixture({
  pin,
  rail,
}: {
  pin: "A" | "B"
  rail: "GND" | "VCC"
}): JSX.Element {
  return (
    <>
      {["TX", "RX"].map((end, index) => {
        let pcbX = index * 16 - 8
        let pcbY = -4
        if (pin === "A") {
          pcbX = index * 10 - 5
          pcbY = 3
        }
        return (
          <Fragment key={end}>
            <resistor
              name={`RSHUNT_${end}_${pin}`}
              resistance="10k"
              footprint="0402"
              pcbX={pcbX}
              pcbY={pcbY}
              connections={{ pin1: `.${end} > .${pin}`, pin2: `net.${rail}` }}
            />
          </Fragment>
        )
      })}
    </>
  )
}

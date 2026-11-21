import React from "react"

interface ReturnAgreementProps {
  spacing?: number
  count?: number
  thickness?: number
  length?: number
}

/** Straight TSX microstrips with broad end contacts on a close, solid bottom reference.
 * Direct opposite-layer contacts remove ground leads and vias from the return.
 * The physical 0.4 mm dielectric comes from the JLC two-layer stackup, without rescaling.
 */
export default function ReturnAgreement({
  spacing = 0.3,
  count = 3,
  thickness = 0.4,
  length = 10,
}: ReturnAgreementProps): React.JSX.Element {
  const half = ((count - 1) * spacing) / 2 + 1
  return (
    <board
      width={length + 2}
      height={2 * half + 1}
      layers={2}
      thickness={thickness}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {[
        { name: "TX", x: -length / 2 },
        { name: "RX", x: length / 2 },
      ].map(({ name, x }) => (
        <chip
          key={name}
          name={name}
          pcbX={x}
          pinLabels={{
            pin1: "S0",
            pin2: "S1",
            pin3: "S2",
            pin4: "GND",
          }}
          connections={{ GND: "net.GND" }}
          footprint={
            <footprint>
              {Array.from({ length: count }, (_, j) => {
                const pin = `pin${j + 1}`
                return (
                  <React.Fragment key={pin}>
                    <smtpad
                      portHints={[pin]}
                      pcbX={0}
                      pcbY={(j - (count - 1) / 2) * spacing}
                      width={0.15}
                      height={0.15}
                      shape="rect"
                    />
                  </React.Fragment>
                )
              })}
              <smtpad
                portHints={["pin4"]}
                pcbX={0}
                pcbY={0}
                width={0.3}
                height={2 * half}
                shape="rect"
                layer="bottom"
              />
            </footprint>
          }
        />
      ))}
      {Array.from({ length: count }, (_, j) => {
        const from = `.TX > .S${j}`
        const to = `.RX > .S${j}`
        return (
          <React.Fragment key={from}>
            <trace from={from} to={to} width={0.15} pcbPath={[from, to]} />
          </React.Fragment>
        )
      })}
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="bottom" unbroken />
    </board>
  )
}

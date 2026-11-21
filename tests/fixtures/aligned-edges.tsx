import React from "react"

/** Different-layer strip edges share a projection: 0.1/2 equals 0.2 - 0.3/2 physically. */
export function AlignedEdges(): React.JSX.Element {
  return (
    <board
      width={8}
      height={12}
      layers={8}
      thickness={1.2}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      allowBlindAndBuriedVias
    >
      {[
        { name: "A", x: -1, y: -4 },
        { name: "B", x: -1, y: 4 },
        { name: "C", x: 1, y: -4 },
        { name: "D", x: 1, y: 4 },
      ].map(({ name, x, y }) => (
        <chip
          key={name}
          name={name}
          pcbX={x}
          pcbY={y}
          pinLabels={{ pin1: "P" }}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                pcbX={0}
                pcbY={0}
                width={0.2}
                height={0.2}
                shape="rect"
              />
            </footprint>
          }
        />
      ))}
      {(
        [
          {
            layer: "inner4",
            from: ".A > .P",
            to: ".B > .P",
            x: 1.2,
            width: 0.1,
          },
          {
            layer: "inner5",
            from: ".C > .P",
            to: ".D > .P",
            x: -1,
            width: 0.3,
          },
        ] as const
      ).map(({ layer, from, to, x, width }) => {
        return (
          <React.Fragment key={layer}>
            <trace
              from={from}
              to={to}
              width={width}
              pcbPath={[
                from,
                { x: 0, y: 1 },
                {
                  x: 0,
                  y: 1,
                  via: true,
                  fromLayer: "top",
                  toLayer: layer,
                },
                { x, y: 2 },
                { x, y: 6 },
                { x: 0, y: 7 },
                {
                  x: 0,
                  y: 7,
                  via: true,
                  fromLayer: layer,
                  toLayer: "top",
                },
                to,
              ]}
            />
          </React.Fragment>
        )
      })}
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="inner3" unbroken />
      <copperpour connectsTo="net.GND" layer="inner6" unbroken />
    </board>
  )
}

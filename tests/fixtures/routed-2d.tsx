import type { TraceProps } from "@tscircuit/props"
import type React from "react"

/** Real TSX copper, two parallel routed wires and a reference that changes across x=0. */
export function RoutedBoard({
  overlap = false,
  oblique = false,
}: {
  overlap?: boolean
  oblique?: boolean
} = {}): React.JSX.Element {
  let neighbourY = 0.35
  if (overlap) neighbourY = 0.08
  let nearPlaneTop = 5
  const neighbourPath: NonNullable<TraceProps["pcbPath"]> = [".C > .P"]
  if (oblique) {
    nearPlaneTop = 0.3
    neighbourPath.push(
      { x: 1, y: 0 },
      {
        x: 1,
        y: 0,
        via: true as const,
        fromLayer: "top" as const,
        toLayer: "inner1" as const,
      },
      { x: 7, y: 0.95 },
      {
        x: 7,
        y: 0.95,
        via: true as const,
        fromLayer: "inner1" as const,
        toLayer: "top" as const,
      },
    )
  }
  neighbourPath.push(".D > .P")
  return (
    <board
      width={16}
      height={12}
      layers={8}
      thickness={1.2}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      allowBlindAndBuriedVias
    >
      {[
        ["A", -4, 0],
        ["B", 4, 0],
        ["C", -4, neighbourY],
        ["D", 4, neighbourY],
        ["E", 2, 0],
      ].map(([name, x, y]) => (
        <chip
          key={name}
          name={String(name)}
          pcbX={Number(x)}
          pcbY={Number(y)}
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
      <trace
        from=".A > .P"
        to=".B > .P"
        width={0.1}
        pcbPath={[".A > .P", ".B > .P"]}
      />
      <trace
        from=".B > .P"
        to=".E > .P"
        width={0.1}
        pcbPath={[".B > .P", ".E > .P"]}
      />
      <trace from=".C > .P" to=".D > .P" width={0.1} pcbPath={neighbourPath} />
      {overlap && (
        <trace
          from=".B > .P"
          to=".D > .P"
          width={0.1}
          pcbPath={[".B > .P", ".D > .P"]}
        />
      )}
      <net name="GND" />
      <net name="VDDQ" />
      <copperpour
        name="NEAR"
        connectsTo="net.GND"
        layer="inner1"
        unbroken
        outline={[
          { x: -7, y: -5 },
          { x: 0, y: -5 },
          { x: 0, y: nearPlaneTop },
          { x: -7, y: nearPlaneTop },
        ]}
      />
      <copperpour
        name="POWER"
        connectsTo="net.VDDQ"
        layer="inner5"
        unbroken
        outline={[
          { x: -7, y: -5 },
          { x: 7, y: -5 },
          { x: 7, y: 5 },
          { x: -7, y: 5 },
        ]}
      />
      <copperpour
        name="BEHIND"
        connectsTo="net.GND"
        layer="inner6"
        unbroken
        outline={[
          { x: -7, y: -5 },
          { x: 7, y: -5 },
          { x: 7, y: 5 },
          { x: -7, y: 5 },
        ]}
      />
      <copperpour
        name="FAR"
        connectsTo="net.GND"
        layer="inner3"
        unbroken
        outline={[
          { x: -7, y: -5 },
          { x: 7, y: -5 },
          { x: 7, y: 5 },
          { x: -7, y: 5 },
        ]}
      />
    </board>
  )
}

/** Direct via-in-pad access has no nonzero planar wire on either pad's top layer. */
export function ViaPadBoard(): React.JSX.Element {
  return (
    <board
      width={12}
      height={8}
      layers={8}
      thickness={1.2}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
      allowBlindAndBuriedVias
    >
      <chip
        name="VIA_PAD"
        pinLabels={{ pin1: "A", pin2: "B" }}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={-3}
              pcbY={0}
              width={0.3}
              height={0.3}
              shape="rect"
            />
            <smtpad
              portHints={["pin2"]}
              pcbX={3}
              pcbY={0}
              width={0.3}
              height={0.3}
              shape="rect"
            />
          </footprint>
        }
      />
      <trace
        from=".VIA_PAD > .A"
        to=".VIA_PAD > .B"
        width={0.1}
        pcbPath={[
          ".VIA_PAD > .A",
          { x: -3, y: 0 },
          {
            x: -3,
            y: 0,
            via: true,
            fromLayer: "top",
            toLayer: "inner2",
          },
          { x: 3, y: 0 },
          {
            x: 3,
            y: 0,
            via: true,
            fromLayer: "inner2",
            toLayer: "top",
          },
          ".VIA_PAD > .B",
        ]}
      />
      <net name="GND" />
      <copperpour connectsTo="net.GND" layer="inner3" unbroken />
    </board>
  )
}

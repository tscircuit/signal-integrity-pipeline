import type React from "react"
import { Wire } from "./copper-scope-board"

/** Place a polygon plated pad beside a bottom-layer channel. */
export function PlatedPadSpanBoard({
  rotation,
}: {
  rotation: number
}): React.JSX.Element {
  return (
    <board
      width={18}
      height={18}
      layers={4}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} layer="bottom" />
      <chip
        name="ROTATED"
        pcbY={2.5}
        pcbRotation={rotation}
        pinLabels={{ pin1: "A" }}
        footprint={
          <footprint>
            <platedhole
              portHints={["pin1"]}
              pcbX={0}
              pcbY={0}
              shape="hole_with_polygon_pad"
              holeShape="circle"
              holeDiameter={0.3}
              holeOffsetX={0}
              holeOffsetY={0}
              padOutline={[
                { x: -1.6, y: -0.2 },
                { x: 1.6, y: -0.2 },
                { x: 1.6, y: 0.2 },
                { x: -1.6, y: 0.2 },
              ]}
            />
          </footprint>
        }
      />
    </board>
  )
}

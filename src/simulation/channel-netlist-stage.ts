import type { GraphicsObject } from "graphics-debug"
import type { CopperGeometry } from "../board"
import {
  type ChannelNetlistInput,
  ChannelNetlistSolver as NetlistSolver,
} from "./channel-netlist"

/** The netlist inputs and the copper geometry used by the debugger drawing. */
export interface ChannelNetlistStageInput extends ChannelNetlistInput {
  readonly board: Pick<CopperGeometry, "copperScope">
}

/** Constructor inputs for replaying a debugger stage. */
type StageConstructorParams = [ChannelNetlistStageInput]

/** A netlist solver with debugger inputs that can be serialized and replayed. */
interface ChannelNetlistStageSolver extends NetlistSolver {
  getConstructorParams(): StageConstructorParams
}

/** Draw the netlist on the extracted board without coupling netlist generation to copper scope. */
export const ChannelNetlistStage: new (
  input: ChannelNetlistStageInput,
) => ChannelNetlistStageSolver =
  class ChannelNetlistSolver extends NetlistSolver {
    private readonly board: ChannelNetlistStageInput["board"]

    /** Forward only the electrical inputs to the domain solver. */
    constructor({ board, ...input }: ChannelNetlistStageInput) {
      super(input)
      this.board = board
    }

    /** Include the board scope for replaying the drawing. */
    override getConstructorParams(): StageConstructorParams {
      const [input] = super.getConstructorParams()
      return [{ ...input, board: this.board }]
    }

    /** Draw the compiled parts on the scoped board. */
    override visualize(): GraphicsObject {
      return this.visualizeNetlist(this.board.copperScope)
    }
  }

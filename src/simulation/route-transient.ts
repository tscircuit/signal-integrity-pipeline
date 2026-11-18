import type { SolverRequest } from "../solver"
import type { RoutedDeck } from "./routed-types"

/** Native batch writes complete ASCII raw vectors for the declarative transient deck. */
export function routedRequest(
  compiled: Pick<RoutedDeck, "deck">,
): SolverRequest & { outputFiles: ["waveform.raw"] } {
  return {
    solver: "ngspice",
    files: { "simulation.cir": compiled.deck },
    args: ["-n", "-b", "-r", "waveform.raw", "simulation.cir"],
    outputFiles: ["waveform.raw"],
  }
}

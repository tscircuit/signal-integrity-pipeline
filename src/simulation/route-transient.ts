import type { SolverRequest } from "../solver"
import type { RoutedDeck } from "./route-inputs"

/** A solver request with the routed transient's single raw waveform output. */
type RoutedSolverRequest = SolverRequest & { outputFiles: ["waveform.raw"] }

/** Native batch writes complete ASCII raw vectors for the declarative transient deck. */
export function routedRequest(
  compiled: Pick<RoutedDeck, "deck">,
): RoutedSolverRequest {
  return {
    solver: "ngspice",
    files: { "simulation.cir": compiled.deck },
    args: ["-n", "-b", "-r", "waveform.raw", "simulation.cir"],
    outputFiles: ["waveform.raw"],
  }
}

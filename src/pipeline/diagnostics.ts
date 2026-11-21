import { diagnostics } from "../kernel"
export const fail = diagnostics("pipeline", [
  "channel_driver_terminal_missing",
  "channel_fanout",
  "channel_net",
  "channel_receiver_terminal_missing",
] as const)

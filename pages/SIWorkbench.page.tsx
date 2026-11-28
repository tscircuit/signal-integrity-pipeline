import type { JSX } from "react"
import { Workbench } from "../site/workbench/workbench"

/** Open the Workbench Start Page. */
function Home(): JSX.Element {
  return <Workbench />
}

/** Open the built-in parallel bus sample. */
function Default(): JSX.Element {
  return <Workbench initialSample="default" />
}

/** Open the private DDR3 sample configured in the dev server. */
function DDR(): JSX.Element {
  return <Workbench initialSample="ddr" />
}

/** Cosmos displays multi-fixture entries in declaration order. */
const SIWorkbench = { Home, Default, DDR }

export default SIWorkbench

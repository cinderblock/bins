/**
 * "/" — whichever surface this deployment opens on.
 *
 * Two genuinely different jobs want two different home screens:
 *
 * - `scanner` (default): the camera IS the home screen. Right when you're
 *   working through a pile of boxes — scan, snap, next — and navigation
 *   between boxes would just be friction.
 * - `browse`: the box list + search, with scanning one prominent tap away
 *   (/scan). Right for a standing warehouse, where the question is usually
 *   "which box is the thing in", not "log this next box".
 * - `shelves`: the wall itself. Right where the shelving IS the index and
 *   people navigate by where things are rather than by searching.
 *
 * All three surfaces stay reachable either way; only the default changes.
 * The scanner also has its own stable URL (/scan) so it can be linked to.
 */
import { useDeployment } from "~/lib/deployment";
import { useDeskMode } from "~/lib/deskMode";
import Bins from "./bins";
import Scanner from "./scanner";
import Shelves from "./shelves";

export default function Home() {
  const deployment = useDeployment();
  // A device in desk mode never opens on the camera, whatever the deployment
  // default is — see lib/deskMode.
  const deskMode = useDeskMode();
  // Render nothing rather than flashing the camera on before we know: on a
  // browse-home deployment, briefly opening the viewfinder would light the
  // LED and re-prompt on iOS for a screen the user never asked for.
  if (deployment === undefined || deskMode === undefined) return null;
  // Desk mode is a device saying "no camera here", so it overrides a
  // camera-first default — but not a shelves-first one, which is just as
  // sensible at a desk.
  if (deployment.homeView === "shelves") return <Shelves />;
  if (deskMode) return <Bins />;
  return deployment.homeView === "browse" ? <Bins /> : <Scanner />;
}

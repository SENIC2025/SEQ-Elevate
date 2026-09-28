import { getProjectMemberships } from "@/lib/auth-helpers";
import { workspacesFor, type WorkspaceId } from "@/lib/workspaces";
import { AppHeaderClient } from "./AppHeaderClient";

/**
 * App header for the signed-in areas. A server wrapper: it resolves the
 * viewer's real workspaces (from their project roles) so the client header
 * can offer a workspace switcher — without every layout fetching roles itself.
 *
 * Fails open to "no switcher": the header must never take a page down.
 */
export async function AppHeader({
  showRoleSwitch = true,
}: {
  showRoleSwitch?: boolean;
}) {
  let workspaces: WorkspaceId[] = [];
  try {
    const roles = (await getProjectMemberships("seq-elevate")).map(
      (m) => m.role
    );
    if (roles.length) workspaces = workspacesFor(roles).map((w) => w.id);
  } catch {
    workspaces = [];
  }
  return (
    <AppHeaderClient showRoleSwitch={showRoleSwitch} workspaces={workspaces} />
  );
}

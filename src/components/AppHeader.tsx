import { getProjectMemberships } from "@/lib/auth-helpers";
import { workspacesFor, type WorkspaceId } from "@/lib/workspaces";
import { AppHeaderClient } from "./AppHeaderClient";

/**
 * App header for the signed-in areas. A server wrapper: it resolves the
 * viewer's real workspaces (from their project roles) so the client header
 * can offer a workspace switcher — without every layout fetching roles itself.
 *
 * Fails open to "no switcher": the header must never take a page down.
 *
 * `showWorkspaces={false}` leaves the workspace switcher out (the profile
 * step, /welcome: no workspace opens before it is done); sign-out, the
 * languages and Reading help stay.
 */
export async function AppHeader({
  showRoleSwitch = true,
  showWorkspaces = true,
}: {
  showRoleSwitch?: boolean;
  showWorkspaces?: boolean;
}) {
  let workspaces: WorkspaceId[] = [];
  try {
    const roles = showWorkspaces
      ? (await getProjectMemberships("seq-elevate")).map((m) => m.role)
      : [];
    if (roles.length) workspaces = workspacesFor(roles).map((w) => w.id);
  } catch {
    workspaces = [];
  }
  return (
    <AppHeaderClient showRoleSwitch={showRoleSwitch} workspaces={workspaces} />
  );
}

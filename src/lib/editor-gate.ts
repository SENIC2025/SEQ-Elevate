import "server-only";

/**
 * The page gate for the authoring screens: may the viewer create and edit
 * content? Call it at the top of every such page, BEFORE loading anything —
 * a layout gate is not enough, because App Router layouts don't re-render
 * when navigating between sibling routes.
 *
 * Reads the per-request cached memberships (auth-helpers.ts), which the header
 * has usually loaded already, so it costs no extra query. Deliberately a plain
 * server module, not a "use server" export, so it is never a public endpoint.
 * Server actions keep their own requireEditor() checks.
 */

import { getViewerRoles } from "@/lib/server-queries";
import { canEditContent } from "@/lib/permissions";

export async function viewerCanEditContent(): Promise<boolean> {
  // getViewerRoles fails to [] — a DB error shows the notice, never the data.
  return canEditContent(await getViewerRoles());
}

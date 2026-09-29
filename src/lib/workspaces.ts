/**
 * Which workspaces a signed-in user can open, derived from their REAL project
 * roles — never from client state. Drives the post-sign-in "Your workspaces"
 * hub and the header's workspace switcher: the production equivalent of the
 * demo's role picker (D26).
 *
 * The role → workspace rules mirror the server-side gates they lead to:
 *   content     — canEditContent: Editor, or Admin which includes it
 *                 (the CMS actions' requireEditor)
 *   courses     — canEditContent (same gate as content)
 *   admin       — ADMIN
 *   facilitator — FACILITATOR or ADMIN      (getProjectLearners)
 *   analytics   — FACILITATOR or ADMIN      (the analytics page's isStaff)
 *   learner     — everyone signed in
 *
 * Pure (no server imports), so client components can use it too.
 */

import type { Role } from "@prisma/client";
import { canEditContent } from "@/lib/permissions";

export type WorkspaceId =
  | "content"
  | "courses"
  | "admin"
  | "facilitator"
  | "analytics"
  | "learner";

export interface Workspace {
  id: WorkspaceId;
  /** Locale-less path; pass to the i18n-aware Link. */
  href: string;
}

export const WORKSPACE_HREF: Record<WorkspaceId, string> = {
  content: "/content",
  courses: "/content/courses",
  admin: "/admin",
  facilitator: "/facilitator",
  analytics: "/analytics",
  learner: "/learner",
};

/** The user's workspaces, most relevant first. Always includes "learner". */
export function workspacesFor(roles: readonly Role[]): Workspace[] {
  const has = (r: Role) => roles.includes(r);
  const ids: WorkspaceId[] = [];
  if (canEditContent(roles)) ids.push("content", "courses");
  if (has("ADMIN")) ids.push("admin");
  if (has("FACILITATOR") || has("ADMIN")) ids.push("facilitator", "analytics");
  ids.push("learner");
  return ids.map((id) => ({ id, href: WORKSPACE_HREF[id] }));
}

/**
 * The workspaces worth advertising (e.g. in an invitation): everything except
 * "My learning" — unless that is all the person has.
 */
export function featuredWorkspaces(roles: readonly Role[]): Workspace[] {
  const all = workspacesFor(roles);
  return all.length > 1 ? all.filter((w) => w.id !== "learner") : all;
}

/** The most senior role held — for "Your role: …" in an invitation. */
export function primaryRole(roles: readonly Role[]): Role {
  for (const r of ["ADMIN", "CONTENT_EDITOR", "FACILITATOR"] as const) {
    if (roles.includes(r)) return r;
  }
  return "LEARNER";
}

/**
 * The workspace a (locale-less) pathname belongs to, if any. The LONGEST
 * matching route wins: /content/courses/… sits under /content, and must still
 * be labelled "Manage courses" rather than "Create courses".
 */
export function workspaceForPath(pathname: string): WorkspaceId | null {
  let best: WorkspaceId | null = null;
  for (const id of Object.keys(WORKSPACE_HREF) as WorkspaceId[]) {
    const href = WORKSPACE_HREF[id];
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > WORKSPACE_HREF[best].length)) {
      best = id;
    }
  }
  return best;
}

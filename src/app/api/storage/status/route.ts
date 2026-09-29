/**
 * GET /api/storage/status — can this account upload files here, right now?
 * The authoring UI asks on load (to show "File storage connected" or what's
 * missing) and again after a failed upload, because the browser Blob SDK
 * drops the upload route's reason.
 *
 *   signed out → 401 { signedIn: false }
 *   signed in  → { signedIn: true, canUpload, storage: "ready" | "missing" }
 *                admins also get source: "standard" | "prefixed" (which env
 *                var naming supplied the token) to help diagnose a setup.
 *
 * Never returns a token value or an environment variable name. Per-request
 * and per-user, so never cached.
 */

import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { describeBlobToken } from "@/lib/blob-token";
import { canEditContent } from "@/lib/permissions";
import type { StorageStatus } from "@/lib/uploads";

const PROJECT = "seq-elevate";
const NO_STORE = { "Cache-Control": "no-store" };

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    const body: StorageStatus = { signedIn: false };
    return Response.json(body, { status: 401, headers: NO_STORE });
  }
  const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
  const blob = describeBlobToken();
  const body: StorageStatus = {
    signedIn: true,
    canUpload: canEditContent(roles),
    storage: blob.ready ? "ready" : "missing",
    ...(roles.includes("ADMIN") && blob.source !== "missing"
      ? { source: blob.source }
      : {}),
  };
  return Response.json(body, { headers: NO_STORE });
}

/**
 * POST /api/admin/people/[id]/export — an ADMIN downloads everything we
 * hold about one person, for a data request DIESIS logged in its register
 * (spec 13.4, SP30, D88). A form on /admin/data posts here and the browser
 * downloads the answer.
 *
 * - ADMIN with project scope only, checked here on the server
 *   (requireAdminProject); anyone else gets 403 (401 with no session).
 * - The Origin header must be this app's own: a link or another site can't
 *   make an admin's browser send the request.
 * - A request reference in the register's format (REQ-YYYY-NNN) is
 *   required, never free text: it is kept in the export's log row.
 * - The file is collectUserData's, as the person's own download is: it
 *   includes the whole Comp Card and reflections, which is why only this
 *   logged path gives them to staff (D81). Never cached.
 * - Logged as account.exported: the admin, the person, the reference.
 * Only POST is served (a GET is answered 405 by Next).
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { collectUserData } from "@/lib/gdpr-export";
import { isRequestRef, recordDataExport } from "@/lib/account-data";
import { requireAdminProject } from "@/lib/scope";

export const dynamic = "force-dynamic";

const plain = (status: number, text: string) =>
  new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Is the request from this app's own pages (its Origin is ours, or AUTH_URL's)? */
function fromOurPages(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const ours = new Set([new URL(request.url).origin]);
  try {
    if (env.AUTH_URL) ours.add(new URL(env.AUTH_URL).origin);
  } catch {
    // An unreadable AUTH_URL adds nothing.
  }
  return ours.has(origin);
}

/** The request reference the form (or a JSON body) sends. */
async function requestRefOf(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      return (await request.formData()).get("requestRef");
    }
    const body = await request.text();
    return body ? (JSON.parse(body) as { requestRef?: unknown } | null)?.requestRef : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!fromOurPages(request)) return plain(403, "Forbidden");
  const admin = await requireAdminProject();
  if (!admin?.user) return (await getCurrentUser()) ? plain(403, "Forbidden") : plain(401, "Unauthorized");

  const requestRef = await requestRefOf(request);
  if (!isRequestRef(requestRef)) return plain(400, "A request reference (REQ-YYYY-NNN) is required");

  const { id } = await params;
  const data = await collectUserData(id);
  if (!data) return plain(404, "Not found");
  await recordDataExport({ actorId: admin.user.id, userId: id, requestRef });

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="seq-elevate-data-${requestRef}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

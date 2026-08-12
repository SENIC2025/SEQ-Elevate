/**
 * POST /api/video/upload — issues a Vercel Blob client-upload token so a
 * content author can upload a lesson video straight to Blob storage (bypassing
 * the 4.5 MB serverless body limit — videos are large). Gated to signed-in
 * staff (ADMIN / CONTENT_EDITOR) and restricted to video files.
 *
 * Requires BLOB_READ_WRITE_TOKEN (set automatically when a Vercel Blob store
 * is connected to the project). Without it, uploads fail and the authoring UI
 * falls back to an in-browser preview — see VideoBlockAuthor.
 *
 * GDPR / data residency (D13): the connected Blob store is in the EU — region
 * `fra1` (Frankfurt / AWS eu-central-1), verified in the dashboard. Region is a
 * store property set at creation and can't be changed later; any future store
 * must also be `fra1`. Nothing in this file depends on the region.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { checkRateLimit } from "@/lib/rate-limit";

const PROJECT = "seq-elevate";
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED = [
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
];

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Runs in the user's request context (cookies present) — authorise here.
        const user = await getCurrentUser();
        if (!user) throw new Error("Not authenticated");
        const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
        const canAuthor =
          roles.includes("ADMIN") || roles.includes("CONTENT_EDITOR");
        if (!canAuthor) throw new Error("Not authorised to upload");
        // Defence in depth: cap token requests per author (staff already, but
        // this bounds a runaway client or a compromised account).
        const rl = await checkRateLimit(`upload-video:${user.id}`, {
          limit: 30,
          windowMs: 60_000,
        });
        if (!rl.ok) throw new Error("Too many uploads — please slow down.");
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      // Fires server-to-server from Blob after upload (production only — Vercel
      // can't call back to localhost). Best-effort; not required for success.
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (error) {
    return Response.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}

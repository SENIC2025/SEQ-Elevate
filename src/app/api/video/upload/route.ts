/**
 * POST /api/video/upload — issues a Vercel Blob client-upload token so a
 * content author can upload a lesson video straight to Blob storage (bypassing
 * the 4.5 MB serverless body limit — videos are large). Gated to signed-in
 * staff who can edit content (Editor, or Admin which includes it) and
 * restricted to the video types and size in VIDEO_UPLOAD.
 *
 * Needs the Blob read-write token, which Vercel sets when a Blob store is
 * connected to the project — under BLOB_READ_WRITE_TOKEN, or a custom-prefixed
 * name; resolveBlobToken() finds either. Refusals come back as
 * `{ error, code }` with a stable code (see UploadRefusalCode) so the
 * authoring UI can say what's wrong — see VideoBlockAuthor.
 *
 * GDPR / data residency (D13): the connected Blob store is in the EU — region
 * `fra1` (Frankfurt / AWS eu-central-1), verified in the dashboard. Region is a
 * store property set at creation and can't be changed later; any future store
 * must also be `fra1`. Nothing in this file depends on the region.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveBlobToken } from "@/lib/blob-token";
import { canEditContent } from "@/lib/permissions";
import {
  VIDEO_UPLOAD,
  UploadRefusedError,
  refusalResponse,
} from "@/lib/uploads";

const PROJECT = "seq-elevate";

export async function POST(request: Request): Promise<Response> {
  // Without a token nothing below can work — say so plainly.
  const token = resolveBlobToken();
  if (!token) return refusalResponse("storage-missing");
  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      token,
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Runs in the user's request context (cookies present) — authorise here.
        const user = await getCurrentUser();
        if (!user) throw new UploadRefusedError("signed-out");
        const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
        if (!canEditContent(roles)) throw new UploadRefusedError("not-editor");
        // Defence in depth: cap token requests per author (staff already, but
        // this bounds a runaway client or a compromised account).
        const rl = await checkRateLimit(`upload-video:${user.id}`, {
          limit: 30,
          windowMs: 60_000,
        });
        if (!rl.ok) throw new UploadRefusedError("rate-limited");
        return {
          allowedContentTypes: [...VIDEO_UPLOAD.contentTypes],
          maximumSizeInBytes: VIDEO_UPLOAD.maxBytes,
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
    if (error instanceof UploadRefusedError) return refusalResponse(error.code);
    console.error("[upload] video token request failed", error);
    return Response.json(
      { error: (error as Error).message, code: "failed" },
      { status: 400 }
    );
  }
}

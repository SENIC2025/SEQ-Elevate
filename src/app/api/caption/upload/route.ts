/**
 * POST /api/caption/upload — Vercel Blob client-upload token for a lesson
 * video's WebVTT captions, so learners load them from storage rather than
 * from the author's browser. Gated to signed-in staff who can edit content
 * (Editor, or Admin which includes it); restricted to the caption type and
 * size in CAPTION_UPLOAD. Mirrors the video upload route, including its
 * `{ error, code }` refusals.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveBlobToken } from "@/lib/blob-token";
import { canEditContent } from "@/lib/permissions";
import {
  CAPTION_UPLOAD,
  UploadRefusedError,
  refusalResponse,
} from "@/lib/uploads";

const PROJECT = "seq-elevate";

export async function POST(request: Request): Promise<Response> {
  const token = resolveBlobToken();
  if (!token) return refusalResponse("storage-missing");
  try {
    const body = (await request.json()) as HandleUploadBody;
    const json = await handleUpload({
      token,
      body,
      request,
      onBeforeGenerateToken: async () => {
        const user = await getCurrentUser();
        if (!user) throw new UploadRefusedError("signed-out");
        const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
        if (!canEditContent(roles)) throw new UploadRefusedError("not-editor");
        const rl = await checkRateLimit(`upload-caption:${user.id}`, {
          limit: 30,
          windowMs: 60_000,
        });
        if (!rl.ok) throw new UploadRefusedError("rate-limited");
        return {
          allowedContentTypes: [...CAPTION_UPLOAD.contentTypes],
          maximumSizeInBytes: CAPTION_UPLOAD.maxBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (error) {
    if (error instanceof UploadRefusedError) return refusalResponse(error.code);
    console.error("[upload] caption token request failed", error);
    return Response.json(
      { error: (error as Error).message, code: "failed" },
      { status: 400 }
    );
  }
}

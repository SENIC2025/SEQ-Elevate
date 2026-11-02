/**
 * POST /api/document/upload — Vercel Blob client-upload token for lesson
 * documents (PDF, Office, images, text). Gated to signed-in staff who can edit
 * content (Editor, or Admin which includes it); restricted to the document
 * allowlist and size in DOCUMENT_UPLOAD. A file is stored only as the type
 * its name's extension implies (D119): a name without one of the list's
 * extensions is refused ("file-type"), so the address a document is kept
 * under says what it is served as. Mirrors the video upload route,
 * including its `{ error, code }` refusals.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveBlobToken } from "@/lib/blob-token";
import { canEditContent } from "@/lib/permissions";
import {
  DOCUMENT_UPLOAD,
  UploadRefusedError,
  refusalResponse,
  typeForName,
  UPLOAD_FAILED,
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
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user) throw new UploadRefusedError("signed-out");
        const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
        if (!canEditContent(roles)) throw new UploadRefusedError("not-editor");
        const rl = await checkRateLimit(`upload-doc:${user.id}`, {
          limit: 30,
          windowMs: 60_000,
        });
        if (!rl.ok) throw new UploadRefusedError("rate-limited");
        const contentType = typeForName(pathname, DOCUMENT_UPLOAD);
        if (!contentType) throw new UploadRefusedError("file-type");
        return {
          allowedContentTypes: [contentType],
          maximumSizeInBytes: DOCUMENT_UPLOAD.maxBytes,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (error) {
    if (error instanceof UploadRefusedError) return refusalResponse(error.code);
    console.error("[upload] document token request failed", error);
    return Response.json(UPLOAD_FAILED, { status: 400 });
  }
}

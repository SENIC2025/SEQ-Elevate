/**
 * POST /api/document/upload — Vercel Blob client-upload token for lesson
 * documents (PDF, Office, images, text). Gated to signed-in ADMIN /
 * CONTENT_EDITOR; restricted to a document allowlist. Mirrors the video
 * upload route. Falls back to in-browser preview if Blob isn't configured.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";

const PROJECT = "seq-elevate";
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const user = await getCurrentUser();
        if (!user) throw new Error("Not authenticated");
        const roles = (await getProjectMemberships(PROJECT)).map((m) => m.role);
        if (!roles.includes("ADMIN") && !roles.includes("CONTENT_EDITOR")) {
          throw new Error("Not authorised to upload");
        }
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

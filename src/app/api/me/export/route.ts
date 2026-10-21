/**
 * GET /api/me/export — download everything we hold about the signed-in user
 * as a JSON file (GDPR Art. 15 / 20). 401 for guests. Records the export in
 * the audit trail, on the server only (no action writes that record).
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { collectUserData } from "@/lib/gdpr-export";
import { recordDataExport } from "@/lib/account-data";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const data = await collectUserData(user.id);
  if (!data) {
    return new Response("Not found", { status: 404 });
  }
  await recordDataExport({ actorId: user.id, userId: user.id });

  const filename = `seq-elevate-my-data-${user.id}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

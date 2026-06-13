/**
 * GET /api/me/export — download everything we hold about the signed-in user
 * as a JSON file (GDPR Art. 15 / 20). 401 for guests. Records the export in
 * the audit trail.
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { collectUserData } from "@/lib/gdpr-export";
import { logDataExport } from "@/app/actions/gdpr";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const data = await collectUserData(user.id);
  if (!data) {
    return new Response("Not found", { status: 404 });
  }
  await logDataExport();

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

import { PEOPLE_TABLES, PERSONAS, answers, type Row } from "./kit";

/**
 * The action table's rows for Stream D's files (spec 17.3): gdpr.ts and
 * the export route (and admin-data.ts and the admin export route once they
 * exist). Exporting and deleting are one's own: aimed at anyone else, or
 * with no session, nothing is read out or removed.
 */

const GDPR = "src/app/actions/gdpr.ts";

export const rows: Row[] = [
  {
    kind: "call",
    file: GDPR,
    name: "deleteMyAccount",
    page: "/en/account",
    args: (c) => [c.target.email],
    refuse: PERSONAS,
    partnerAdmin: "anyone",
    outcome: (as) =>
      answers({ ok: false, error: as === "anonymous" ? "not-authenticated" : "confirmation-mismatch" }),
    tables: PEOPLE_TABLES,
    why: "an account is deleted only by its holder, who confirms it with their own address (SP28)",
  },
  {
    kind: "route",
    route: "GET /api/me/export",
    method: "GET",
    path: () => "/api/me/export",
    refuse: ["anonymous"],
    status: () => 401,
    tables: ["AuditLog"],
    why: "the data download is the signed-in person's own (SP27)",
  },
];

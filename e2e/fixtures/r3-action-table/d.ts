import { NOT_PEOPLE_MANAGERS, PEOPLE_TABLES, PERSONAS, answers, forbidden, type Row } from "./kit";

/**
 * The action table's rows for Stream D's files (spec 17.3): gdpr.ts,
 * admin-data.ts, the person's own export route and the admin export route.
 * Exporting and deleting are one's own: aimed at anyone else, or with no
 * session, nothing is read out or removed. The data tools and the admin
 * export are an ADMIN's with project scope (SP30, SP31): everyone else is
 * refused, the partner admin by role (D88: DIESIS is the controller), and
 * nothing changes. A refused run of the clean-up would erase nothing in the
 * world anyway, so its row rests on the refusal's answer.
 */

const GDPR = "src/app/actions/gdpr.ts";
const ADMIN_DATA = "src/app/actions/admin-data.ts";
const DATA = "/en/admin/data";

/** The e2e server's own origin: the admin export refuses any other. */
const appOrigin = () => `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

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
  {
    kind: "call",
    file: ADMIN_DATA,
    name: "findPeople",
    page: DATA,
    args: (c) => [c.target.email],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["AuditLog"],
    why: "only an ADMIN with project scope finds people by address (SP31)",
  },
  {
    kind: "call",
    file: ADMIN_DATA,
    name: "markTestAccount",
    page: DATA,
    args: (c) => [c.target.userId, true],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: PEOPLE_TABLES,
    why: "only an ADMIN with project scope marks a test account (SP31, D85)",
  },
  {
    kind: "call",
    file: ADMIN_DATA,
    name: "resetTestAccount",
    page: DATA,
    args: (c) => [c.target.userId],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: PEOPLE_TABLES,
    why: "only an ADMIN with project scope resets an account's learner data (SP31, D85)",
  },
  {
    kind: "call",
    file: ADMIN_DATA,
    name: "eraseAccountByAdmin",
    page: DATA,
    args: (c) => [c.target.userId, { confirmEmail: c.target.email, requestRef: "REQ-2026-001" }],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: [...PEOPLE_TABLES, "VerificationToken"],
    why: "only an ADMIN with project scope erases someone else's account (SP31, D88)",
  },
  {
    kind: "call",
    file: ADMIN_DATA,
    name: "previewCleanup",
    page: DATA,
    args: () => [],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["AuditLog"],
    why: "only an ADMIN with project scope sees the clean-up's dry run (SP31)",
  },
  {
    kind: "call",
    file: ADMIN_DATA,
    name: "runCleanup",
    page: DATA,
    args: () => [{ confirm: "ERASE 0 TEST ACCOUNTS" }],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: [...PEOPLE_TABLES, "VerificationToken"],
    why: "only an ADMIN with project scope runs the clean-up (SP31, D88)",
  },
  {
    kind: "route",
    route: "POST /api/admin/people/[id]/export",
    method: "POST",
    path: (c) => `/api/admin/people/${c.target.userId}/export`,
    // The app's own origin and a well-formed reference: only who asks is wrong.
    headers: () => ({ Origin: appOrigin(), "Content-Type": "application/json" }),
    body: () => ({ requestRef: "REQ-2026-001" }),
    refuse: PERSONAS,
    partnerAdmin: "role",
    status: (as) => (as === "anonymous" ? 401 : 403),
    tables: ["AuditLog"],
    why: "only an ADMIN with project scope exports someone else's data, for a logged request (SP30)",
  },
];

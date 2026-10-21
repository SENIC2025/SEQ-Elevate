import { NOT_PEOPLE_MANAGERS, forbidden, type Row } from "./kit";

/**
 * The action table's rows for Stream F's files (spec 17.3): safeguarding.ts.
 * The safeguarding contacts are an ADMIN's with project scope (SP36, D93):
 * everyone else is refused, the partner admin by role (it doesn't edit
 * contacts, not even its own country's), and the project's setting and the
 * log don't change. The contacts sent name the run, so a save that slipped
 * through would show in the project's row.
 */

const SAFEGUARDING = "src/app/actions/safeguarding.ts";

export const rows: Row[] = [
  {
    kind: "call",
    file: SAFEGUARDING,
    name: "saveSafeguardingContacts",
    page: "/en/admin/safeguarding",
    args: (c) => [
      {
        DE: [
          { kind: "organisation", organisation: `E2E refused ${c.run}`, email: "e2e-refused@example.org" },
          { kind: "helpline", organisation: `E2E refused line ${c.run}`, phone: "116 111" },
        ],
      },
    ],
    refuse: NOT_PEOPLE_MANAGERS,
    partnerAdmin: "role",
    outcome: forbidden,
    tables: ["Project", "AuditLog"],
    why: "only an ADMIN with project scope saves the safeguarding contacts (SP36, D93)",
  },
];

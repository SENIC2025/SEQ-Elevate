/**
 * Demo profiles for client showcases. One-click sign-in (no magic-link email)
 * lets a client explore each role. Provisioned in the DB on first use — see
 * src/app/actions/demo.ts. Client-safe (no Prisma import); roles are plain
 * string literals the server casts to the Role enum.
 *
 * SECURITY: this is a demo convenience for showcase deployments with their
 * own database. It runs only where demoLoginAllowed() says so (opt-in,
 * never on production, a private access code: src/lib/demo-gate.ts). Every
 * profile has an address of our own demo domain, never a real person's.
 */

export type DemoRole = "ADMIN" | "CONTENT_EDITOR" | "FACILITATOR" | "LEARNER";

export interface DemoProfile {
  id: string;
  email: string;
  name: string;
  roles: DemoRole[];
  roleLabel: string;
  blurb: string;
  /** Where to land after sign-in (path, locale prepended by the client). */
  landing: string;
}

export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "demo-admin",
    email: "demo-admin@seq-elevate.eu",
    name: "Demo Admin",
    roles: ["ADMIN", "CONTENT_EDITOR"],
    roleLabel: "Admin · Content editor",
    blurb:
      "Full access — edit lesson text, attach videos and documents, and see the admin dashboard.",
    landing: "/content",
  },
  {
    id: "demo123",
    email: "demo123@seq-elevate.eu",
    name: "Demo Editor",
    roles: ["CONTENT_EDITOR"],
    roleLabel: "Content editor",
    blurb:
      "Author content: edit lesson narrative, add interactive videos, upload and order documents.",
    landing: "/content",
  },
  {
    id: "demo321",
    email: "demo321@seq-elevate.eu",
    name: "Demo Teacher",
    roles: ["FACILITATOR"],
    roleLabel: "Facilitator / teacher",
    blurb:
      "See each learner's position, time on task and quiz results; publish documents to a cohort.",
    landing: "/facilitator",
  },
  {
    id: "demo-learner",
    email: "demo-learner@seq-elevate.eu",
    name: "Demo Learner",
    roles: ["LEARNER"],
    roleLabel: "Learner",
    blurb:
      "Walk a course as a young person — video with pop-up quiz, scenario, Comp Card and badges.",
    landing: "/learner",
  },
];

export function getDemoProfile(id: string): DemoProfile | undefined {
  return DEMO_PROFILES.find((p) => p.id === id);
}

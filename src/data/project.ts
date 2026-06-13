/**
 * Project (multi-tenant root).
 *
 * Every other entity in the platform — Course, Scenario, Mission, Comp Card,
 * User, Cohort, Organisation, Badge — belongs to exactly one Project.
 * Projects are isolated: a SEQ Elevate facilitator cannot see Selevate
 * learners, courses are not cross-shared, brand kits don't bleed.
 *
 * In the real shell, the Project is resolved from the subdomain
 * (seq-elevate.senic.world → "seq-elevate") in the proxy.ts middleware.
 * In this demo, there is one project (SEQ Elevate). The architecture is
 * here so the second project is configuration, not engineering.
 */

import { SKILL_CLUSTERS, type SkillCluster } from "./course";

export interface BrandKit {
  name: string;
  shortName: string;
  tagline: string;
  primaryColor: string;
  primaryHover: string;
  accentColor: string;
  // Future: logoUrl, fontFamily, customCss
}

export interface ProjectConfig {
  id: string;
  brand: BrandKit;
  /** Locales available in this project's UI + courses. */
  locales: readonly string[];
  defaultLocale: string;
  /** Skill clusters this project teaches (subset of the global set). */
  clusters: readonly SkillCluster[];
  /** EU funding programme this project belongs to. */
  programme: "Erasmus+" | "Horizon Europe" | "Other";
  /** Consortium partner short names, for cohort labelling. */
  partners: readonly string[];
}

export const PROJECTS: Record<string, ProjectConfig> = {
  "seq-elevate": {
    id: "seq-elevate",
    brand: {
      name: "SEQ Elevate",
      shortName: "SEQ Elevate",
      tagline: "Skills for life, work and what comes next.",
      // Palette matches seqelevate.eu (Bricks WP theme):
      // --primary #cad12c (lime), --secondary #7467ae (purple), --tertiary #b575ae (rose).
      primaryColor: "#cad12c",
      primaryHover: "#b6bc28",
      accentColor: "#7467ae",
    },
    locales: ["en", "de", "el"],
    defaultLocale: "en",
    clusters: SKILL_CLUSTERS,
    programme: "Erasmus+",
    partners: ["Diesis Network", "Pro Arbeit", "Synthesis", "University of Macedonia"],
  },
  // Future projects land here as pure configuration. Example shape (commented):
  //
  // "selevate": {
  //   id: "selevate",
  //   brand: {
  //     name: "Selevate",
  //     shortName: "Selevate",
  //     tagline: "Sustainable skills for the social economy.",
  //     primaryColor: "#2563eb",
  //     primaryHover: "#1d4ed8",
  //     accentColor: "#db2777",
  //   },
  //   locales: ["en", "fr", "it"],
  //   defaultLocale: "en",
  //   clusters: ["communicationEi", "resilience", "teamwork", "leadership"],
  //   programme: "Horizon Europe",
  //   partners: ["Partner A", "Partner B"],
  // },
};

export const DEFAULT_PROJECT_ID = "seq-elevate";

export function getProject(id?: string): ProjectConfig {
  const resolved = id && id in PROJECTS ? id : DEFAULT_PROJECT_ID;
  return PROJECTS[resolved];
}

export function listProjects(): ProjectConfig[] {
  return Object.values(PROJECTS);
}

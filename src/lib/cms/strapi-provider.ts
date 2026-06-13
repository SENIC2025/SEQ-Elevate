/**
 * Strapi CMS provider — fetches authored content from the Strapi REST API
 * and maps it to the source-agnostic CourseContent shape.
 *
 * Active when CMS_SOURCE=strapi. Requires STRAPI_URL (and optionally
 * STRAPI_API_TOKEN for non-public content). The Course content type stores
 * course-level metadata as native fields and the nested stage structure in
 * a localized `content` JSON field that already matches CourseStage[].
 */

import type { CMSProvider } from "./provider";
import type {
  CourseContent,
  CourseStage,
  CourseSummary,
  CompCardTemplate,
  Locale,
} from "./types";

const STRAPI_URL = process.env.STRAPI_URL ?? "http://localhost:1337";
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN;

async function strapiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${STRAPI_URL}/api${path}`, {
    headers: STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {},
    // Course content changes rarely; cache for a minute, revalidate on publish.
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Strapi ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Strapi 5 flattens attributes onto the entry; older shape nested them. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function flat(entry: any): any {
  return entry?.attributes ? { id: entry.id, ...entry.attributes } : entry;
}

function toCourseContent(raw: any, locale: Locale): CourseContent {
  const e = flat(raw);
  const stages: CourseStage[] = Array.isArray(e.content) ? e.content : [];
  return {
    slug: e.slug,
    locale,
    cluster: e.cluster ?? "",
    title: e.title ?? "",
    clusterLabel: e.clusterLabel ?? "",
    tagline: e.tagline ?? "",
    durationMinutes: e.durationMinutes ?? 20,
    badge: {
      slug: e.badgeSlug ?? "",
      name: e.badgeName ?? "",
      meaning: e.badgeMeaning ?? "",
    },
    stages,
    completion: {
      title: e.completionTitle ?? "",
      body: e.completionBody ?? "",
    },
  };
}

export const strapiProvider: CMSProvider = {
  async listCourses(_projectId, locale) {
    const json = await strapiFetch<{ data: any[] }>(
      `/courses?locale=${locale}&status=published&fields[0]=slug&fields[1]=cluster&fields[2]=title&fields[3]=clusterLabel&fields[4]=tagline&fields[5]=durationMinutes`
    );
    return (json.data ?? []).map((raw): CourseSummary => {
      const e = flat(raw);
      return {
        slug: e.slug,
        cluster: e.cluster ?? "",
        title: e.title ?? "",
        clusterLabel: e.clusterLabel ?? "",
        tagline: e.tagline ?? "",
        durationMinutes: e.durationMinutes ?? 20,
        status: "published",
      };
    });
  },

  async getCourse(_projectId, slug, locale) {
    const json = await strapiFetch<{ data: any[] }>(
      `/courses?locale=${locale}&status=published&filters[slug][$eq]=${encodeURIComponent(slug)}`
    );
    const entry = json.data?.[0];
    if (!entry) return null;
    return toCourseContent(entry, locale);
  },

  async getCompCardTemplate(_projectId, locale) {
    try {
      const json = await strapiFetch<{ data: any }>(
        `/comp-card-template?locale=${locale}`
      );
      const e = flat(json.data);
      if (e?.fields && Array.isArray(e.fields)) {
        return { fields: e.fields } as CompCardTemplate;
      }
    } catch {
      /* fall through to default */
    }
    // Default template if none authored yet.
    return {
      fields: [
        { key: "wentWell", label: "What went well", kind: "longtext" },
        { key: "difficult", label: "What was difficult", kind: "longtext" },
        { key: "improve", label: "What I'll try next time", kind: "longtext" },
        { key: "behaviour", label: "A behaviour I demonstrated", kind: "longtext" },
        { key: "confidence", label: "How confident I feel now", kind: "confidence" },
      ],
    };
  },
};

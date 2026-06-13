/** Helpers for the dev CMS-check page. Re-exports the client + a label. */
export { getCourse, listCourses, getCompCardTemplate } from "./index";
import { getCMSSource } from "./provider";

export function getCMSSourceLabel(): string {
  return getCMSSource() === "strapi"
    ? "source: Strapi (CMS_SOURCE=strapi)"
    : "source: local (bundled content)";
}

import type { Core } from "@strapi/strapi";

/**
 * SEQ Elevate CMS bootstrap.
 *
 * On boot: ensure the German and Greek locales exist (English is the
 * default) and ensure public read access to Course + Comp Card Template
 * so the Next.js app can fetch published content without an API token in
 * dev. (In production we gate reads with an API token — see cms/README.)
 */

const LOCALES = [
  { code: "de", name: "German (de)" },
  { code: "el", name: "Greek (el)" },
];

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // 1. Ensure locales
    try {
      const localeService = strapi.plugin("i18n").service("locales");
      const existing = await localeService.find();
      const codes = new Set(existing.map((l: { code: string }) => l.code));
      for (const loc of LOCALES) {
        if (!codes.has(loc.code)) {
          await localeService.create(loc);
          strapi.log.info(`[seq-elevate] created locale ${loc.code}`);
        }
      }
    } catch (e) {
      strapi.log.warn(`[seq-elevate] locale bootstrap skipped: ${e}`);
    }

    // 2. Public read permissions for content the app renders
    try {
      const publicRole = await strapi
        .query("plugin::users-permissions.role")
        .findOne({ where: { type: "public" } });

      if (publicRole) {
        const actions = [
          "api::course.course.find",
          "api::course.course.findOne",
          "api::comp-card-template.comp-card-template.find",
        ];
        for (const action of actions) {
          const exists = await strapi
            .query("plugin::users-permissions.permission")
            .findOne({ where: { action, role: publicRole.id } });
          if (!exists) {
            await strapi.query("plugin::users-permissions.permission").create({
              data: { action, role: publicRole.id },
            });
          }
        }
        strapi.log.info("[seq-elevate] public read permissions ensured");
      }
    } catch (e) {
      strapi.log.warn(`[seq-elevate] permission bootstrap skipped: ${e}`);
    }
  },
};

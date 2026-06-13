/**
 * Database seed — bootstraps the SEQ Elevate project, partner orgs, a
 * demo cohort, the workplace-conflict course, and one developer admin
 * user. Idempotent: safe to run multiple times.
 *
 * Run with: pnpm prisma db seed
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PROJECTS, DEFAULT_PROJECT_ID } from "../src/data/project";
import { COURSE_DEFS, COURSE_ORDER } from "../src/data/course";
import en from "../src/messages/en.json";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding SEQ Elevate database…");

  // 1. SEQ Elevate project
  const projectConfig = PROJECTS[DEFAULT_PROJECT_ID];
  const project = await prisma.project.upsert({
    where: { id: projectConfig.id },
    create: {
      id: projectConfig.id,
      name: projectConfig.brand.name,
      shortName: projectConfig.brand.shortName,
      tagline: projectConfig.brand.tagline,
      primaryColor: projectConfig.brand.primaryColor,
      primaryHover: projectConfig.brand.primaryHover,
      accentColor: projectConfig.brand.accentColor,
      programme: projectConfig.programme,
      defaultLocale: projectConfig.defaultLocale,
      locales: [...projectConfig.locales],
      clusters: [...projectConfig.clusters],
      partners: [...projectConfig.partners],
    },
    update: {
      name: projectConfig.brand.name,
      shortName: projectConfig.brand.shortName,
      tagline: projectConfig.brand.tagline,
      primaryColor: projectConfig.brand.primaryColor,
      primaryHover: projectConfig.brand.primaryHover,
      accentColor: projectConfig.brand.accentColor,
      programme: projectConfig.programme,
      locales: [...projectConfig.locales],
      clusters: [...projectConfig.clusters],
      partners: [...projectConfig.partners],
    },
  });
  console.log(`  ✓ Project: ${project.name}`);

  // 2. Consortium partner organisations
  const partnerOrgs = [
    { shortName: "Diesis", name: "Diesis Network" },
    { shortName: "ProArbeit", name: "Pro Arbeit" },
    { shortName: "Synthesis", name: "Synthesis" },
    { shortName: "UoM", name: "University of Macedonia" },
  ];

  for (const p of partnerOrgs) {
    await prisma.organisation.upsert({
      where: {
        // Workaround: no unique on (projectId, shortName) — query first
        id: `${project.id}-${p.shortName.toLowerCase()}`,
      },
      create: {
        id: `${project.id}-${p.shortName.toLowerCase()}`,
        projectId: project.id,
        name: p.name,
        shortName: p.shortName,
      },
      update: {
        name: p.name,
      },
    });
  }
  console.log(`  ✓ Organisations: ${partnerOrgs.map((p) => p.shortName).join(", ")}`);

  // 3. Demo cohort (Berlin Pilot — matches facilitator demo)
  const berlinCohort = await prisma.cohort.upsert({
    where: { id: "berlin-pilot-2026" },
    create: {
      id: "berlin-pilot-2026",
      projectId: project.id,
      organisationId: `${project.id}-proarbeit`,
      name: "Berlin Pilot · Spring 2026",
      startsAt: new Date("2026-04-01"),
      endsAt: new Date("2026-06-30"),
    },
    update: {
      name: "Berlin Pilot · Spring 2026",
    },
  });
  console.log(`  ✓ Cohort: ${berlinCohort.name}`);

  // 4. Courses + badges (one per CourseDef). Badge name/meaning come from
  //    the English completion copy; the strapiId is a placeholder until
  //    courses are authored in Strapi.
  for (const slug of COURSE_ORDER) {
    const def = COURSE_DEFS[slug];
    if (!def) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const copy = (en as any).course[def.contentKey]?.completion ?? {};

    const badge = await prisma.badge.upsert({
      where: { projectId_slug: { projectId: project.id, slug: def.badgeId } },
      create: {
        projectId: project.id,
        slug: def.badgeId,
        name: copy.badgeName ?? def.badgeId,
        meaning: copy.badgeMeaning ?? "",
      },
      update: { name: copy.badgeName ?? def.badgeId, meaning: copy.badgeMeaning ?? "" },
    });

    const course = await prisma.course.upsert({
      where: { projectId_slug: { projectId: project.id, slug: def.id } },
      create: {
        projectId: project.id,
        strapiId: `placeholder-${def.id}`,
        slug: def.id,
        cluster: def.cluster,
        durationMinutes: def.durationMinutes,
        badgeId: badge.id,
        status: "published",
        publishedAt: new Date(),
      },
      update: {
        cluster: def.cluster,
        durationMinutes: def.durationMinutes,
        badgeId: badge.id,
        status: "published",
      },
    });
    console.log(`  ✓ Course: ${course.slug} (badge ${badge.slug})`);
  }

  // 5. Optional staff account — grants FACILITATOR + ADMIN to SEED_STAFF_EMAIL
  //    so the facilitator/admin views can show real data. Set the env to
  //    your email before seeding to provision yourself as staff.
  const staffEmail = process.env.SEED_STAFF_EMAIL;
  if (staffEmail) {
    const staff = await prisma.user.upsert({
      where: { email: staffEmail },
      create: { email: staffEmail, emailVerified: new Date() },
      update: {},
    });
    for (const role of ["FACILITATOR", "ADMIN"] as const) {
      await prisma.membership.upsert({
        where: {
          userId_projectId_role: {
            userId: staff.id,
            projectId: project.id,
            role,
          },
        },
        create: { userId: staff.id, projectId: project.id, role },
        update: {},
      });
    }
    console.log(`  ✓ Staff: ${staffEmail} (FACILITATOR + ADMIN)`);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

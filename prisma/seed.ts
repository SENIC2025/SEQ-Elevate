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
import { COURSE_META } from "../src/data/course";

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

  // 4. Workplace-conflict course
  // Strapi ID is a placeholder until Strapi is wired up in Week 0 Day 4
  const badge = await prisma.badge.upsert({
    where: { projectId_slug: { projectId: project.id, slug: COURSE_META.badgeId } },
    create: {
      projectId: project.id,
      slug: COURSE_META.badgeId,
      name: "Voice without edges",
      meaning: "Spoke up without escalating or shrinking",
    },
    update: {},
  });

  const course = await prisma.course.upsert({
    where: { projectId_slug: { projectId: project.id, slug: COURSE_META.id } },
    create: {
      projectId: project.id,
      strapiId: "placeholder-workplace-conflict",
      slug: COURSE_META.id,
      cluster: COURSE_META.cluster,
      durationMinutes: COURSE_META.durationMinutes,
      badgeId: badge.id,
      status: "published",
      publishedAt: new Date(),
    },
    update: {
      cluster: COURSE_META.cluster,
      durationMinutes: COURSE_META.durationMinutes,
      badgeId: badge.id,
      status: "published",
    },
  });
  console.log(`  ✓ Course: ${course.slug} (badge ${badge.slug})`);

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

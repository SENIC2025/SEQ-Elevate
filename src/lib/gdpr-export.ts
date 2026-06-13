import "server-only";

/**
 * Builds the GDPR data-export payload for a user. This is a server-only
 * helper, NOT a server action — it takes a userId and must only ever be
 * called with a server-derived id (e.g. the authenticated user's own id in
 * the /api/me/export route). Never expose it to the client: that would be an
 * IDOR (any caller could read another user's data).
 */

import { prisma } from "@/lib/prisma";

export async function collectUserData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: { project: true, organisation: true, cohort: true },
      },
      enrollments: { include: { course: true } },
      compCards: { include: { project: true, entries: true } },
      badges: { include: { badge: true } },
      missionProgress: { include: { mission: true } },
      observedNotes: true,
      validatedNotes: true,
    },
  });
  if (!user) return null;

  return {
    exportedAt: new Date().toISOString(),
    notice:
      "This file contains the personal data SEQ Elevate holds about you (GDPR Art. 15 & 20).",
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      accessibility: {
        fontSize: user.fontSize,
        dyslexicFont: user.dyslexic,
        highContrast: user.contrast,
      },
    },
    memberships: user.memberships.map((m) => ({
      project: m.project.name,
      role: m.role,
      organisation: m.organisation?.name ?? null,
      cohort: m.cohort?.name ?? null,
      joinedAt: m.createdAt.toISOString(),
    })),
    courses: user.enrollments.map((e) => ({
      course: e.course.slug,
      stagesCompleted: e.stagesCompleted,
      completedAt: e.completedAt?.toISOString() ?? null,
      simulation:
        e.simulationChoice != null
          ? { choice: e.simulationChoice, correct: e.simulationCorrect }
          : null,
      scenario: { root: e.scenarioRoot, followup: e.scenarioFollowup },
      reflection: e.reflection,
      assessment: e.assessment,
      enrolledAt: e.enrolledAt.toISOString(),
    })),
    compCards: user.compCards.map((c) => ({
      project: c.project.name,
      wentWell: c.wentWell,
      difficult: c.difficult,
      improve: c.improve,
      behaviour: c.behaviour,
      confidence: c.confidence,
      sharingChoice: c.privacy,
      updatedAt: c.updatedAt.toISOString(),
      entries: c.entries.map((en) => ({
        wentWell: en.wentWell,
        difficult: en.difficult,
        improve: en.improve,
        behaviour: en.behaviour,
        confidence: en.confidence,
        scenarioRoot: en.scenarioRoot,
        scenarioFollowup: en.scenarioFollowup,
        createdAt: en.createdAt.toISOString(),
      })),
    })),
    badges: user.badges.map((b) => ({
      badge: b.badge.slug,
      name: b.badge.name,
      awardedAt: b.awardedAt.toISOString(),
    })),
    missions: user.missionProgress.map((mp) => ({
      mission: mp.mission.slug,
      status: mp.status,
      startedAt: mp.startedAt.toISOString(),
      completedAt: mp.completedAt?.toISOString() ?? null,
    })),
    facilitatorObservationsAboutYou: user.observedNotes.map((o) => ({
      note: o.note,
      createdAt: o.createdAt.toISOString(),
    })),
    skillValidationsAboutYou: user.validatedNotes.map((v) => ({
      cluster: v.cluster,
      evidence: v.evidence,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}

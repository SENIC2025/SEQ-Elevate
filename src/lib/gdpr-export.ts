import "server-only";

/**
 * Builds the GDPR data-export payload for a user. This is a server-only
 * helper, NOT a server action — it takes a userId and must only ever be
 * called with a server-derived id: the authenticated user's own id in the
 * /api/me/export route, or the id an ADMIN with project scope exports for a
 * logged data request (POST /api/admin/people/[id]/export). Never expose it
 * to the client: that would be an IDOR (any caller could read another
 * user's data).
 *
 * Release 3 (D87, spec 13.3): the file holds the account and profile, the
 * progress and answers, the Comp Card (its sharing as the learner sees it),
 * badges, the activity records, the log entries about the person (action
 * and date, never who), sessions and pending sign-in links (count and
 * expiry, never a token), the notes staff wrote about the person (signed
 * "a facilitator at ‹organisation›", never by name, and only while the
 * author is still in the organisation they wrote it in) and, for staff, how
 * many notes they wrote (not the text: it is about other people). An
 * organisation recorded on a membership before Release 3 is labelled as
 * such: the person's organisation is the profile's (D72).
 */

import { prisma } from "@/lib/prisma";
import { effectiveSharing } from "@/lib/comp-card-visibility";

const PROJECT = "seq-elevate";

/** The activity records a learner's own use writes (telemetry.ts, video.ts): exported, and erased with the account. */
export const TELEMETRY_ACTIONS = ["course.opened", "stage.time", "video.cue_answered"] as const;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

type Metadata = Record<string, unknown>;
const metadataOf = (value: unknown): Metadata =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Metadata) : {};
const text = (value: unknown) => (typeof value === "string" ? value : null);

type Author = { profiles: { id?: string; organisation: { name: string } | null }[] } | null;

/**
 * Who wrote a note about the person, as the file says it: their
 * organisation, never their name. Only the organisation they were in when
 * they wrote it: an author whose organisation changed since (`movedAt`, the
 * last change of their profile's organisation) signs as "a member of
 * staff".
 */
function signature(author: Author, writtenAt: Date, movedAt: ReadonlyMap<string, Date>): string {
  const profile = author?.profiles[0];
  const organisation = profile?.organisation?.name;
  const moved = profile?.id ? movedAt.get(profile.id) : undefined;
  return organisation && !(moved && moved > writtenAt) ? `a facilitator at ${organisation}` : "a member of staff";
}

const AUTHOR = {
  select: {
    profiles: { where: { projectId: PROJECT }, select: { id: true, organisation: { select: { name: true } } } },
  },
} as const;

/** What an organisation recorded on a membership before Release 3 is (D72): kept, labelled, not used. */
const EARLIER_ORGANISATION_NOTE =
  "Recorded on this membership before profiles were introduced and no longer used: your organisation is the one in your profile.";

export async function collectUserData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: { project: true, organisation: true, cohort: true },
      },
      enrollments: { include: { course: true } },
      compCards: {
        include: { project: true, entries: true, sharedWithOrganisation: { select: { name: true } } },
      },
      badges: { include: { badge: true } },
      missionProgress: { include: { mission: true } },
      observedNotes: { include: { observer: AUTHOR } },
      validatedNotes: { include: { validator: AUTHOR } },
      profiles: { include: { organisation: { select: { name: true } } } },
      staffHistory: { where: { projectId: PROJECT } },
      sessions: { select: { expires: true } },
      _count: { select: { observations: true, validations: true } },
    },
  });
  if (!user) return null;

  const profile = user.profiles.find((p) => p.projectId === PROJECT) ?? null;
  const organisationOf = (projectId: string) =>
    user.profiles.find((p) => p.projectId === projectId)?.organisationId ?? null;
  const [activity, aboutYou, links] = await Promise.all([
    prisma.auditLog.findMany({
      where: { actorId: userId, action: { in: [...TELEMETRY_ACTIONS] } },
      select: { action: true, entityId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { entityId: { in: [userId, ...user.profiles.map((p) => p.id), ...user.compCards.map((c) => c.id)] } },
      select: { action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.verificationToken.findMany({
      where: { identifier: { equals: user.email, mode: "insensitive" } },
      select: { expires: true },
    }),
  ]);
  const staff = user.staffHistory[0] ?? null;
  // When each note author's organisation last changed (setPersonOrganisation
  // logs every change by the profile's id).
  const authorProfiles = [
    ...user.observedNotes.map((o) => o.observer?.profiles[0]?.id),
    ...user.validatedNotes.map((v) => v.validator?.profiles[0]?.id),
  ].filter((id): id is string => typeof id === "string");
  const movedAt = new Map<string, Date>();
  if (authorProfiles.length) {
    const moves = await prisma.auditLog.findMany({
      where: { action: "person.organisation_changed", entityId: { in: [...new Set(authorProfiles)] } },
      select: { entityId: true, createdAt: true },
    });
    for (const m of moves) {
      if (!m.entityId) continue;
      const last = movedAt.get(m.entityId);
      if (!last || m.createdAt > last) movedAt.set(m.entityId, m.createdAt);
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    notice:
      "This file is a copy of the data SEQ Elevate holds about you: your account and profile, your progress, " +
      "answers and Comp Card, your badges, your activity records, the log entries about your account, and the " +
      "notes staff wrote about you (GDPR Art. 15 & 20).",
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      // When the address was first confirmed by a sign-in link.
      emailVerified: iso(user.emailVerified),
      accessibility: {
        fontSize: user.fontSize,
        dyslexicFont: user.dyslexic,
        highContrast: user.contrast,
      },
    },
    profile: profile
      ? {
          project: profile.projectId,
          country: profile.country,
          organisation: profile.organisation?.name ?? null,
          completedAt: iso(profile.profileCompletedAt),
          termsVersion: profile.termsVersion,
          termsAcceptedAt: iso(profile.termsAcceptedAt),
          ageStatement:
            profile.ageRule === "INVITED_WITH_GUARDIAN_CONSENT"
              ? "invited with a parent's or guardian's permission"
              : profile.ageRule === "SELF_MIN_AGE"
                ? "at or above the minimum age"
                : null,
          ageConfirmedAt: iso(profile.ageConfirmedAt),
          consent: profile.consentAt ? { version: profile.consentVersion, at: iso(profile.consentAt) } : null,
          // The day only: who recorded it is not the person's data.
          guardianPermissionRecordedOn: profile.guardianConsentRecordedAt?.toISOString().slice(0, 10) ?? null,
          guardianPermissionCoversSharingOn: profile.guardianSharingConsentAt?.toISOString().slice(0, 10) ?? null,
          markedAsTestAccountAt: iso(profile.testAccountAt),
        }
      : null,
    staffRole: staff ? { since: staff.firstAt.toISOString(), firstRole: staff.firstRole } : null,
    memberships: user.memberships.map((m) => ({
      project: m.project.name,
      role: m.role,
      // Release 3 (D72): the person's organisation is the profile's.
      earlierOrganisation: m.organisation ? { name: m.organisation.name, note: EARLIER_ORGANISATION_NOTE } : null,
      cohort: m.cohort?.name ?? null,
      joinedAt: m.createdAt.toISOString(),
    })),
    courses: user.enrollments.map((e) => ({
      course: e.course.slug,
      stagesCompleted: e.stagesCompleted,
      // Release 2 (D62): lessons of the course's own finished, and every
      // answer without a field of its own, by "lessonId/contentId" — by
      // name, as stored.
      sectionsCompleted: e.sectionsCompleted ?? [],
      responses: e.responses ?? null,
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
    compCards: user.compCards.map((c) => {
      // As the learner's own screen says it (D80): shared only through the
      // sharing step, with the organisation they belong to now.
      const sharing = effectiveSharing(c, organisationOf(c.projectId));
      return {
        project: c.project.name,
        wentWell: c.wentWell,
        difficult: c.difficult,
        improve: c.improve,
        behaviour: c.behaviour,
        confidence: c.confidence,
        sharing,
        sharedAt: sharing === "facilitators" ? iso(c.sharedAt) : null,
        sharedWith: sharing === "facilitators" ? (c.sharedWithOrganisation?.name ?? null) : null,
        // The version of the sharing wording the learner shared under (D80).
        sharingVersion: sharing === "facilitators" ? (c.sharingVersion ?? null) : null,
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
      };
    }),
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
    activity: {
      coursesOpened: activity
        .filter((a) => a.action === "course.opened")
        .map((a) => ({ course: text(metadataOf(a.metadata).courseSlug) ?? a.entityId, at: a.createdAt.toISOString() })),
      timeOnLessons: activity
        .filter((a) => a.action === "stage.time")
        .map((a) => {
          const md = metadataOf(a.metadata);
          return {
            course: text(md.courseSlug),
            lesson: text(md.stage),
            seconds: typeof md.seconds === "number" ? md.seconds : null,
            // A running total: counted since this first record.
            since: a.createdAt.toISOString(),
          };
        }),
      videoAnswers: activity
        .filter((a) => a.action === "video.cue_answered")
        .map((a) => {
          const md = metadataOf(a.metadata);
          return {
            course: text(md.courseSlug),
            lesson: text(md.lessonId),
            cue: a.entityId,
            correct: typeof md.correct === "boolean" ? md.correct : null,
            at: a.createdAt.toISOString(),
          };
        }),
    },
    logEntriesAboutYou: aboutYou.map((r) => ({ action: r.action, at: r.createdAt.toISOString() })),
    sessions: { count: user.sessions.length, expires: user.sessions.map((s) => s.expires.toISOString()) },
    pendingSignInLinks: { count: links.length, expires: links.map((l) => l.expires.toISOString()) },
    facilitatorObservationsAboutYou: user.observedNotes.map((o) => ({
      note: o.note,
      createdAt: o.createdAt.toISOString(),
      by: signature(o.observer, o.createdAt, movedAt),
    })),
    skillValidationsAboutYou: user.validatedNotes.map((v) => ({
      cluster: v.cluster,
      evidence: v.evidence,
      createdAt: v.createdAt.toISOString(),
      by: signature(v.validator, v.createdAt, movedAt),
    })),
    // Staff: how many notes and validations they wrote about learners. Not
    // the text, which is about other people.
    notesYouWrote:
      user._count.observations || user._count.validations
        ? { notes: user._count.observations, validations: user._count.validations }
        : null,
  };
}

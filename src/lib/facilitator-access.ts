/**
 * Who may write a facilitator's observation note or competence validation,
 * and about whom (C20).
 *
 * Both land on another person's record, which the learner reads in their
 * data export and the admin audit shows. So the writer must be a FACILITATOR
 * or ADMIN of the project (the same people who see the facilitator
 * workspace, getProjectLearners), and the person written about must be a
 * learner of the same project (isProjectLearner): someone who isn't in the
 * project at all is refused, and so is anyone holding a staff role there.
 * Staff who opened a learner page before Release 0 still hold the LEARNER
 * role that page used to give everyone, so the LEARNER role alone would let
 * one colleague write on another's record. Nobody writes about themselves
 * either: a writer is staff, so the rule above already refuses that, and
 * the action compares the ids as well. Organisation and cohort aren't
 * checked yet; nothing else scopes staff by them either (D25).
 *
 * What is written is checked here too, as a server action is a public
 * endpoint: text of a sensible length, and a cluster that exists.
 *
 * Pure (no database), so it can be tested on its own.
 */

import type { Role } from "@prisma/client";
import { SKILL_CLUSTERS, type SkillCluster } from "@/data/course";
import { isProjectLearner } from "@/lib/learner-scope";

/** Roles that may record observations and validations in a project. */
export const FACILITATOR_WRITE_ROLES: readonly Role[] = ["FACILITATOR", "ADMIN"];

/**
 * May someone holding `writerRoles` in the project write about a person
 * holding `learnerRoles` in it?
 */
export function canRecordForLearner(
  writerRoles: readonly Role[],
  learnerRoles: readonly Role[]
): boolean {
  return (
    writerRoles.some((r) => FACILITATOR_WRITE_ROLES.includes(r)) &&
    isProjectLearner(learnerRoles)
  );
}

/**
 * The longest note or evidence kept, in characters: room for a few
 * paragraphs, but not for a pasted document on someone else's record.
 */
export const FACILITATOR_TEXT_MAX = 2000;

/**
 * `text` trimmed, when it is text no longer than FACILITATOR_TEXT_MAX;
 * otherwise null, and the action refuses rather than cutting it short.
 */
export function facilitatorText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length <= FACILITATOR_TEXT_MAX ? trimmed : null;
}

/** Is `cluster` one of the skill clusters a competence belongs to? */
export function isSkillCluster(cluster: unknown): cluster is SkillCluster {
  return (
    typeof cluster === "string" &&
    (SKILL_CLUSTERS as readonly string[]).includes(cluster)
  );
}

/** Letters only, lower case: "Problem solving" and "problem-solving" alike. */
const letters = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");

/**
 * The skill cluster a key or a skill area names: a bundled course's key
 * ("resilience"), or the free-text skill area of a course created in the
 * platform ("Problem solving", "problem-solving"). Read as letters only, it
 * is a cluster's key in full or its start ("Communication" →
 * communicationEi). Null for any other skill area: the facilitator chooses.
 */
export function courseSkillCluster(cluster: unknown): SkillCluster | null {
  if (typeof cluster !== "string") return null;
  const area = letters(cluster);
  // Too short to say which cluster it means.
  if (area.length < 4) return null;
  const named = SKILL_CLUSTERS.filter((c) => letters(c).startsWith(area));
  return named.length === 1 ? named[0] : null;
}

/**
 * The skill cluster of a course (its database row), so a validation starts
 * on the right one. A bundled course has no copy of its own (`meta`), and
 * its `cluster` is the cluster's key. A course created in the platform says
 * its skill area in each language's copy (`meta[locale].clusterLabel`),
 * which an editor can change on the course page; its `cluster` is a key
 * made once, by createCourse, from the skill area it was created with
 * ("communication" when it had none), and doesn't follow. So its skill
 * areas are read: the cluster that those naming one agree on, or null when
 * none names one or they name different ones.
 */
export function skillClusterOfCourse(course: {
  cluster: string;
  meta?: unknown;
}): SkillCluster | null {
  if (!course.meta || typeof course.meta !== "object") {
    return courseSkillCluster(course.cluster);
  }
  const named = new Set<SkillCluster>();
  for (const copy of Object.values(course.meta)) {
    const area = courseSkillCluster(
      (copy as { clusterLabel?: unknown } | null)?.clusterLabel
    );
    if (area) named.add(area);
  }
  return named.size === 1 ? [...named][0] : null;
}

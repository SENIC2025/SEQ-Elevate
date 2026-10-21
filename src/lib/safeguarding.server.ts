import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { EMPTY_SAFEGUARDING, parseSafeguarding, type SafeguardingSetting } from "@/lib/safeguarding";

/**
 * Release 3 (D93, spec 11.2): the safeguarding contacts as saved
 * (Project.safeguarding), read once per request. A failed read gives no
 * contacts, never an error page: the box and /help then show 112 and the
 * fallback line, never nothing. One log line, without the contacts.
 */

const PROJECT = "seq-elevate";

export const loadSafeguarding = cache(async (): Promise<SafeguardingSetting> => {
  return (await readSafeguarding("showing 112 and the fallback")) ?? EMPTY_SAFEGUARDING;
});

/**
 * The contacts as saved, or null when they can't be read: what the admin
 * screen edits, which must never offer "no contacts" for a failed read (a
 * save would then remove them all).
 */
export async function readSafeguarding(onError = "not shown"): Promise<SafeguardingSetting | null> {
  try {
    const project = await prisma.project.findUnique({ where: { id: PROJECT }, select: { safeguarding: true } });
    return parseSafeguarding(project?.safeguarding ?? null);
  } catch (e) {
    console.error(`[safeguarding] couldn't read the contacts; ${onError}: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}

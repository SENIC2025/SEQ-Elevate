import type { Prisma } from "@prisma/client";
import { isOwnStoreUrl } from "@/lib/media-url";

/**
 * Release 3 (D92, spec 10.4): course files whose record goes are queued
 * here and deleted later by the logged admin run, never at once. Partners
 * finish their courses under a content freeze, often clearing a video in
 * one lesson and pasting its link into another, or swapping a file and
 * swapping back; the store has no backup, so a file removed by mistake must
 * stay usable for a while.
 *
 * Editor actions (lesson.ts, sections.ts deleteSection) call
 * queueFileDeletion inside their own transaction, so a file is queued
 * exactly when its record goes, and never waits on the store: nothing is
 * deleted here. The admin clean-up run (account-data.ts deletePendingFiles,
 * on production only) deletes a queued file once it has been queued for
 * 7 days and no lesson document or lesson video (source, poster, captions)
 * uses it any more; one pasted back is taken off the queue and kept.
 *
 * Contract with that run: each queued URL is exactly the string the record
 * held (Lesson.video's src, poster or caption src; LessonDocument.url), never
 * a normalised form (no lower-cased host, dropped query or decoded path).
 * The run decides "used again" by comparing the files records name now with
 * the queued ones; it matches the file an address names (host case, query,
 * fragment and encoding aside), which only ever keeps more files, and the
 * exact string keeps that comparison true even if it is ever made exact.
 * e2e/r3-media.spec.ts (E-E10) queues through the real action, pastes the
 * URL back through the editor and expects the run to drop it.
 *
 * Only files of our own store (BLOB_PUBLIC_HOST) are queued: the bundled
 * samples and links on other hosts are not ours to delete.
 */

type Env = Record<string, string | undefined>;

/** Why a file was queued (PendingFileDeletion.reason). */
export type FileQueueReason = "document.removed" | "video.cleared" | "video.replaced" | "section.deleted";

/** Every file a stored video names: its source, poster and caption tracks, as stored. */
export function videoFileUrls(video: unknown): string[] {
  if (!video || typeof video !== "object") return [];
  const v = video as { src?: unknown; poster?: unknown; captions?: unknown };
  const captions = Array.isArray(v.captions)
    ? v.captions.map((c) => (c && typeof c === "object" ? (c as { src?: unknown }).src : undefined))
    : [];
  return [v.src, v.poster, ...captions].filter((u): u is string => typeof u === "string" && u.length > 0);
}

/**
 * Queues each of `urls` that is a file of our own store, through the
 * caller's transaction `tx`, exactly as given. A file already queued (pasted
 * back, then removed again) starts its week again. Answers the URLs queued.
 */
export async function queueFileDeletion(
  tx: Pick<Prisma.TransactionClient, "pendingFileDeletion">,
  urls: readonly unknown[],
  reason: FileQueueReason,
  env: Env = process.env
): Promise<string[]> {
  const ours = [...new Set(urls.filter((u): u is string => typeof u === "string" && isOwnStoreUrl(u, env)))];
  for (const url of ours) {
    await tx.pendingFileDeletion.upsert({
      where: { url },
      create: { url, reason },
      update: { reason, queuedAt: new Date() },
    });
  }
  return ours;
}

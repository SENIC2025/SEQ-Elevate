"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STAGES } from "@/data/course";
import {
  getLessonMedia,
  addLessonDocument,
  removeLessonDocument,
} from "@/app/actions/lesson";
import type { LessonDocumentRef } from "@/lib/cms/types";
import {
  FileText,
  Upload,
  Loader2,
  Trash2,
  AlertTriangle,
  FolderOpen,
} from "lucide-react";

const ACCEPT =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,image/*";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Upload documents (PDF/Office/images) and attach them to a lesson. */
export function LessonDocumentManager({
  courses,
}: {
  courses: { slug: string; title: string }[];
}) {
  const [courseSlug, setCourseSlug] = React.useState(courses[0]?.slug ?? "");
  const [stageKey, setStageKey] = React.useState("concept");
  const [docs, setDocs] = React.useState<LessonDocumentRef[]>([]);
  const [status, setStatus] = React.useState<"idle" | "uploading" | "error">(
    "idle"
  );
  const [reloadKey, setReloadKey] = React.useState(0);
  const refresh = () => setReloadKey((k) => k + 1);

  // Load the lesson's documents whenever the lesson (or a reload) changes.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!courseSlug) return;
      const media = await getLessonMedia(courseSlug, stageKey);
      if (!cancelled) setDocs(media.documents);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseSlug, stageKey, reloadKey]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStatus("uploading");
    try {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(f.name, f, {
        access: "public",
        handleUploadUrl: "/api/document/upload",
      });
      const res = await addLessonDocument(courseSlug, stageKey, {
        name: f.name,
        url: blob.url,
        mimeType: f.type || "application/octet-stream",
        sizeBytes: f.size,
      });
      setStatus(res.ok ? "idle" : "error");
      if (res.ok) await refresh();
    } catch {
      setStatus("error");
    }
    e.target.value = "";
  }

  async function onRemove(id: string) {
    await removeLessonDocument(id);
    await refresh();
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Lesson documents</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Attach PDFs, Office files or images to a lesson.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Course</span>
            <select
              value={courseSlug}
              onChange={(e) => setCourseSlug(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              {courses.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="block mb-1">Lesson stage</span>
            <select
              value={stageKey}
              onChange={(e) => setStageKey(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm capitalize"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-sm cursor-pointer hover:bg-[var(--surface-muted)]">
            {status === "uploading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload document
            <input
              type="file"
              accept={ACCEPT}
              onChange={onFile}
              disabled={status === "uploading"}
              className="sr-only"
            />
          </label>
        </div>

        {status === "error" ? (
          <p className="mt-2 text-xs text-[var(--danger)] flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Couldn&apos;t save — sign in as a content editor (and connect Vercel
            Blob).
          </p>
        ) : null}

        <div className="mt-4">
          {docs.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              No documents on this lesson yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <FileText className="h-4 w-4 text-[var(--muted-foreground)] flex-shrink-0" />
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate hover:underline"
                  >
                    {d.name}
                  </a>
                  <Badge variant="muted" className="text-[10px]">
                    {formatSize(d.sizeBytes)}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => onRemove(d.id)}
                    aria-label={`Remove ${d.name}`}
                    className="rounded-md p-1 text-[var(--muted-foreground)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LessonDocumentViewer } from "./LessonDocumentViewer";
import type { LessonDocumentRef } from "@/lib/cms/types";
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  Download,
  PlaySquare,
} from "lucide-react";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv")
    return FileSpreadsheet;
  return FileText;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * Lesson documents, shown two ways at once: a "Step through" guided viewer
 * (slides 1.1 → 1.2) and an ordered downloadable list. `stageNumber` is the
 * lesson's 1-based position so items read 1.1, 1.2, 1.3…
 */
export function LessonDocuments({
  documents,
  stageNumber,
}: {
  documents: LessonDocumentRef[];
  stageNumber?: number;
}) {
  const t = useTranslations("lesson");
  const [viewerStart, setViewerStart] = React.useState<number | null>(null);
  if (!documents.length) return null;

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-label={t("resourcesTitle")}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Download className="h-4 w-4 text-[var(--accent)]" />
          {t("resourcesTitle")}
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setViewerStart(0)}
        >
          <PlaySquare className="h-4 w-4" />
          {t("stepThrough")}
        </Button>
      </div>

      <ol className="space-y-1.5">
        {documents.map((d, i) => {
          const Icon = iconFor(d.mimeType);
          const seq = stageNumber ? `${stageNumber}.${i + 1}` : `${i + 1}`;
          return (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-muted)]"
            >
              <span className="flex-shrink-0 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-xs font-semibold text-[var(--accent)] tabular-nums">
                {seq}
              </span>
              <Icon className="h-4 w-4 text-[var(--muted-foreground)] flex-shrink-0" />
              <button
                type="button"
                onClick={() => setViewerStart(i)}
                className="flex-1 truncate text-left hover:underline"
                title={t("viewInViewer")}
              >
                {d.name}
              </button>
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                {formatSize(d.sizeBytes)}
              </span>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t("download")} ${d.name}`}
                className="rounded-md p-1 text-[var(--accent)] hover:bg-[var(--accent)]/10"
              >
                <Download className="h-4 w-4" />
              </a>
            </li>
          );
        })}
      </ol>

      {viewerStart !== null ? (
        <LessonDocumentViewer
          documents={documents}
          startIndex={viewerStart}
          stageNumber={stageNumber}
          onClose={() => setViewerStart(null)}
        />
      ) : null}
    </section>
  );
}

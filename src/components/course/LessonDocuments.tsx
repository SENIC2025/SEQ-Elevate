"use client";

import { useTranslations } from "next-intl";
import type { LessonDocumentRef } from "@/lib/cms/types";
import { FileText, FileImage, FileSpreadsheet, Download } from "lucide-react";

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

/** Downloadable documents attached to a lesson (authored in the CMS). */
export function LessonDocuments({
  documents,
}: {
  documents: LessonDocumentRef[];
}) {
  const t = useTranslations("lesson");
  if (!documents.length) return null;
  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-label={t("resourcesTitle")}
    >
      <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
        <Download className="h-4 w-4 text-[var(--accent)]" />
        {t("resourcesTitle")}
      </h3>
      <ul className="space-y-1.5">
        {documents.map((d) => {
          const Icon = iconFor(d.mimeType);
          return (
            <li key={d.id}>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-muted)]"
              >
                <Icon className="h-4 w-4 text-[var(--muted-foreground)] flex-shrink-0" />
                <span className="flex-1 truncate">{d.name}</span>
                <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                  {formatSize(d.sizeBytes)}
                </span>
                <Download className="h-3.5 w-3.5 text-[var(--accent)] flex-shrink-0" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

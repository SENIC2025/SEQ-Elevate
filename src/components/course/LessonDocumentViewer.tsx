"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { LessonDocumentRef } from "@/lib/cms/types";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ExternalLink,
} from "lucide-react";

/**
 * Guided "slides" viewer — steps through a lesson's documents one at a time
 * (1.1 → 1.2 …) with prev/next and keyboard arrows. Images and PDFs preview
 * inline; other formats (Office) show an open/download card — we deliberately
 * don't route documents through a third-party viewer (privacy).
 */
export function LessonDocumentViewer({
  documents,
  startIndex = 0,
  stageNumber,
  onClose,
}: {
  documents: LessonDocumentRef[];
  startIndex?: number;
  stageNumber?: number;
  onClose: () => void;
}) {
  const t = useTranslations("lesson");
  const [index, setIndex] = React.useState(
    Math.min(Math.max(startIndex, 0), documents.length - 1)
  );
  const dialogRef = React.useRef<HTMLDivElement>(null);

  const go = React.useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), documents.length - 1));
    },
    [documents.length]
  );

  React.useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!documents.length) return null;
  const doc = documents[index];
  const seq = stageNumber ? `${stageNumber}.${index + 1}` : `${index + 1}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("viewerTitle")}
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-3 sm:p-6 outline-none"
    >
      {/* Header */}
      <div className="flex items-center gap-3 text-white">
        <span className="rounded bg-white/15 px-2 py-0.5 text-sm font-semibold tabular-nums">
          {seq}
        </span>
        <p className="flex-1 truncate text-sm font-medium">{doc.name}</p>
        <span className="text-xs text-white/70 tabular-nums">
          {t("docPosition", { current: index + 1, total: documents.length })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="rounded-md p-1.5 text-white/80 hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Preview */}
      <div className="relative my-3 flex-1 overflow-hidden rounded-lg bg-[var(--surface)]">
        <DocPreview key={doc.id} doc={doc} t={t} />
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(-1)}
          disabled={index === 0}
        >
          <ChevronLeft className="h-4 w-4" />
          {t("previous")}
        </Button>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          {documents.map((d, i) => (
            <span
              key={d.id}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? "w-5 bg-white"
                  : "w-1.5 bg-white/40"
              }`}
            />
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => go(1)}
          disabled={index === documents.length - 1}
        >
          {t("next")}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function DocPreview({
  doc,
  t,
}: {
  doc: LessonDocumentRef;
  t: ReturnType<typeof useTranslations>;
}) {
  if (doc.mimeType.startsWith("image/")) {
    // Arbitrary author-uploaded images of unknown dimensions — a plain <img>
    // is correct here (next/image needs known sizes + configured domains).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={doc.url} alt={doc.name} className="h-full w-full object-contain" />;
  }
  if (doc.mimeType === "application/pdf") {
    return (
      <iframe
        src={doc.url}
        title={doc.name}
        className="h-full w-full border-0"
      />
    );
  }
  // Office / other — no safe inline preview; offer to open.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FileText className="h-12 w-12 text-[var(--muted-foreground)]" />
      <p className="text-sm text-[var(--muted-foreground)] max-w-sm">
        {t("noPreview")}
      </p>
      <a href={doc.url} target="_blank" rel="noopener noreferrer">
        <Button size="sm">
          <ExternalLink className="h-4 w-4" />
          {t("openDocument")}
        </Button>
      </a>
      <a href={doc.url} download className="text-xs text-[var(--accent)] inline-flex items-center gap-1">
        <Download className="h-3.5 w-3.5" />
        {t("download")}
      </a>
    </div>
  );
}

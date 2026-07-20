"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProject } from "@/components/ProjectThemeProvider";
import { VideoBlockAuthor } from "@/components/role/VideoBlockAuthor";
import { LessonDocumentManager } from "@/components/role/LessonDocumentManager";
import { LessonNarrativeEditor } from "@/components/role/LessonNarrativeEditor";
import { CourseCatalogueManager } from "@/components/role/CourseCatalogueManager";
import { CompCardTemplateEditor } from "@/components/role/CompCardTemplateEditor";
import { StructureAuthor } from "@/components/role/StructureAuthor";
import type { Locale } from "@/lib/cms/types";
import {
  BookOpen,
  Compass,
  ClipboardCheck,
  Target,
  Award,
  CheckCircle2,
  PenSquare,
  Languages,
  AlertTriangle,
  FolderKanban,
  Lock,
  Sparkles,
  ArrowRight,
  Film,
} from "lucide-react";

const MODELS = [
  {
    id: "course",
    Icon: BookOpen,
    name: "Course",
    fields: [
      "title",
      "cluster",
      "durationMinutes",
      "stages (Context → Concept → Behaviour → Simulation → Scenario → Reflection → Assessment)",
    ],
    status: "published",
  },
  {
    id: "scenario",
    Icon: Compass,
    name: "Scenario",
    fields: ["setup", "rootQuestion", "rootChoices[]", "followups[]", "outcomes[]", "qualityTags"],
    status: "published",
  },
  {
    id: "video",
    Icon: Film,
    name: "Interactive video",
    fields: [
      "source (upload | URL)",
      "provider (file | youtube)",
      "title, poster, caption",
      "cues[] (atSeconds, question, options[], correct, explanation)",
    ],
    status: "published",
  },
  {
    id: "compCardTemplate",
    Icon: ClipboardCheck,
    name: "Comp Card template",
    fields: ["fields[]", "privacyOptions", "branding", "PDF style"],
    status: "draft",
  },
  {
    id: "mission",
    Icon: Target,
    name: "Mission",
    fields: ["title", "courseRef", "triggerCondition"],
    status: "published",
  },
  {
    id: "badge",
    Icon: Award,
    name: "Badge",
    fields: ["name", "meaning", "unlockedBy", "iconRef"],
    status: "published",
  },
];

const COURSE_TREE = [
  {
    locale: "en",
    label: "English",
    items: [
      { name: "Handling workplace conflict", status: "published" },
      { name: "Asking for help at a new job", status: "draft" },
    ],
  },
  {
    locale: "de",
    label: "Deutsch",
    items: [
      { name: "Mit Konflikten am Arbeitsplatz umgehen", status: "review" },
    ],
  },
  {
    locale: "el",
    label: "Ελληνικά",
    items: [
      { name: "Διαχείριση μιας μικρής διαφωνίας στη δουλειά", status: "review" },
    ],
  },
];

export function ContentEditor({
  courses = [],
  locale = "en",
}: {
  courses?: { slug: string; title: string }[];
  locale?: Locale;
}) {
  const t = useTranslations("content");
  const tCommon = useTranslations("common");
  const { project } = useProject();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {t("title")}
        </h1>
        <Badge variant="muted" className="text-[10px]">
          Strapi CMS
        </Badge>
      </div>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("cmsNote")}</p>

      {/* Project context — multi-tenant root */}
      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
          <FolderKanban className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
            Project
          </p>
          <p className="font-semibold">{project.brand.name}</p>
        </div>
        <select
          value={project.id}
          disabled
          className="bg-[var(--surface-muted)] border border-[var(--border)] rounded-md px-3 py-1.5 text-sm text-[var(--muted-foreground)] cursor-not-allowed flex items-center gap-1"
          aria-label="Switch project (disabled in demo)"
          title="Multi-tenant architecture is wired. Second project would land here as configuration."
        >
          <option value={project.id}>{project.brand.name}</option>
          <option disabled>— more projects available in production —</option>
        </select>
        <div className="basis-full text-xs text-[var(--muted-foreground)] mt-1 flex items-center gap-1.5">
          <Lock className="h-3 w-3" />
          Content authored here belongs to <strong>{project.brand.name}</strong> only — strict data isolation between projects.
        </div>
      </div>

      {/* Live preview CTA — the hero of this surface */}
      <Card className="mt-5 overflow-hidden border-[var(--accent)]/30">
        <CardContent className="p-0">
          <div className="grid sm:grid-cols-[1fr_auto] gap-0">
            <div className="p-5">
              <Badge variant="primary" className="mb-2">
                <Sparkles className="h-3 w-3" />
                New
              </Badge>
              <h2 className="text-lg font-bold">Live scenario preview</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)] max-w-xl">
                See the learner-side view update live as you edit. The fastest way for partner authors to see what their changes look like before publishing.
              </p>
              <div className="mt-3">
                <Link href="/content/preview">
                  <Button size="md">
                    Open live preview
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
            <div className="hidden sm:flex items-center justify-center bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] p-6 text-white min-w-[180px]">
              <PenSquare className="h-12 w-12 opacity-90" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Course lifecycle — publish / unpublish the catalogue */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Courses</h2>
      <CourseCatalogueManager locale={locale} />

      {/* Lesson narrative — edit the teaching text per language */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Edit lesson narrative</h2>
      <LessonNarrativeEditor courses={courses} />

      {/* Interactive video authoring — add a lesson video with in-video quiz */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Add interactive video</h2>
      <VideoBlockAuthor courses={courses} />

      {/* Lesson documents — upload and attach files to a lesson */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Lesson documents</h2>
      <LessonDocumentManager courses={courses} />

      {/* Interactive stages — simulation / scenario / assessment authoring */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Interactive stages</h2>
      <StructureAuthor />

      {/* Comp Card template — reword/reorder/hide the reflection fields */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Comp Card template</h2>
      <CompCardTemplateEditor />

      {/* Content models */}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Content models</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODELS.map((m) => (
          <Card key={m.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                  <m.Icon className="h-5 w-5" />
                </div>
                <StatusBadge status={m.status} />
              </div>
              <p className="font-semibold">{m.name}</p>
              <ul className="mt-2 text-xs text-[var(--muted-foreground)] space-y-0.5">
                {m.fields.map((f) => (
                  <li key={f} className="leading-snug">
                    · {f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Locale tree */}
      <h2 className="mt-10 mb-3 text-lg font-semibold flex items-center gap-2">
        <Languages className="h-5 w-5 text-[var(--accent)]" />
        Courses · localisation tree
      </h2>
      <Card>
        <CardContent className="p-5">
          <div className="grid sm:grid-cols-3 gap-4">
            {COURSE_TREE.map((c) => (
              <div key={c.locale}>
                <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mb-2 flex items-center gap-1.5">
                  <Languages className="h-3.5 w-3.5" />
                  {c.label}
                </p>
                <ul className="space-y-1.5">
                  {c.items.map((item) => (
                    <li
                      key={item.name}
                      className="flex items-center justify-between gap-2 text-sm rounded-md border border-[var(--border)] px-3 py-1.5"
                    >
                      <span className="truncate">{item.name}</span>
                      <StatusBadge status={item.status} small />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Editorial workflow */}
      <h2 className="mt-10 mb-3 text-lg font-semibold">Editorial workflow</h2>
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Step icon={<PenSquare className="h-4 w-4" />} label="Draft" active />
            <Arrow />
            <Step icon={<Languages className="h-4 w-4" />} label="Translate" />
            <Arrow />
            <Step icon={<CheckCircle2 className="h-4 w-4" />} label="Review" />
            <Arrow />
            <Step icon={<Award className="h-4 w-4" />} label="Publish" />
          </div>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Versioning, accessibility warnings (reading level, alt text, contrast) and translation memory are wired into the CMS.
          </p>
        </CardContent>
      </Card>

      <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--muted-foreground)] flex gap-3">
        <AlertTriangle className="h-4 w-4 text-[var(--accent)] flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-[var(--foreground)]">{tCommon("demoBannerLine1")}</p>
          <p className="mt-1">{tCommon("demoBannerLine2")}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, small = false }: { status: string; small?: boolean }) {
  const variant =
    status === "published"
      ? "success"
      : status === "draft"
        ? "muted"
        : "accent";
  return (
    <Badge variant={variant} className={small ? "text-[10px]" : ""}>
      {status}
    </Badge>
  );
}

function Step({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
        active
          ? "border-[var(--primary)] bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
          : "border-[var(--border)] text-[var(--muted-foreground)]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Arrow() {
  return (
    <span className="text-[var(--muted-foreground)] text-xs" aria-hidden="true">
      →
    </span>
  );
}
